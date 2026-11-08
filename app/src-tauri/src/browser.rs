//! The web in the preview: pages from outside this machine (a search, a
//! library's docs, a service the project calls), which the proxy (preview.rs)
//! cannot frame. Each opens in a webview of its own laid over the Preview
//! tab's viewport (components/preview/preview.tsx keeps it there), with the same agent
//! inside (agent.js). The page never calls the app: the tab asks it things by
//! running script in it and collects what it has to say the same way, so a
//! site on the open web is handed nothing of the app's.
//!
//! And Claude's clicks and keys, on macOS: given to the webview as AppKit
//! events, the preview's own frame or one of these pages alike. A page cannot
//! tell them from a person's, so whatever works for the user works for Claude:
//! a popup, a file picker, a button in a frame from another site.

use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, WebviewBuilder, WebviewUrl};

const AGENT: &str = include_str!("agent.js");
const GONE: &str = "The page is gone from the preview.";

fn web(url: &str) -> Result<Url, String> {
    let u = Url::parse(url).map_err(|_| format!("Not an address: {url}"))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(format!("Only http and https pages open in the preview, not {url}"));
    }
    Ok(u)
}

/// A page from the web, at a place in the window: CSS pixels of the app's
/// page, with `zoom` the scale the viewport is drawn at. With `project`, in
/// that project's own store of sign-ins rather than the shared one (signins.rs).
/// `label` is the tab's to choose, so the page's first load, which can finish
/// before this returns, is already known to be its own.
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: f64,
    project: Option<String>,
) -> Result<String, String> {
    let window = app.get_window("main").ok_or("The window is gone.")?;
    if !label.starts_with("browser-") || app.get_webview(&label).is_some() {
        return Err(format!("Not a label for a new page: {label}"));
    }
    let (tell, me) = (app.clone(), label.clone());
    let (own, mine) = (app.clone(), label.clone());
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(web(&url)?))
        // Told that it is asked, rather than posting to a page around it.
        .initialization_script(format!("(function (BLUPRINT_NATIVE) {{\n{AGENT}\n}})(true);"))
        .on_page_load(move |_, load| {
            let done = matches!(load.event(), PageLoadEvent::Finished);
            let _ = tell.emit_to("main", "bluprint:browser", json!({ "label": me, "url": load.url().as_str(), "done": done }));
        })
        // The preview is one page: what would open a window opens here.
        .on_new_window(move |url, _| {
            if let Some(view) = own.get_webview(&mine) {
                let _ = view.navigate(url);
            }
            NewWindowResponse::Deny
        });
    if let Some(root) = project {
        builder = builder.data_store_identifier(crate::signins::store_of(&root));
    }
    let view = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    let _ = view.set_zoom(zoom);
    Ok(label)
}

#[tauri::command]
pub async fn browser_place(app: AppHandle, label: String, x: f64, y: f64, width: f64, height: f64, zoom: f64, shown: bool) -> Result<(), String> {
    let view = app.get_webview(&label).ok_or(GONE)?;
    let bounds = Rect { position: LogicalPosition::new(x, y).into(), size: LogicalSize::new(width, height).into() };
    view.set_bounds(bounds).map_err(|e| e.to_string())?;
    view.set_zoom(zoom).map_err(|e| e.to_string())?;
    if shown { view.show() } else { view.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_go(app: AppHandle, label: String, url: String) -> Result<(), String> {
    app.get_webview(&label).ok_or(GONE)?.navigate(web(&url)?).map_err(|e| e.to_string())
}

/// Runs `js` in the page and returns its value. The tab's agent calls go
/// through this, and so does collecting what the page has said since.
#[tauri::command]
pub async fn browser_eval(app: AppHandle, label: String, js: String) -> Result<Value, String> {
    let view = app.get_webview(&label).ok_or(GONE)?;
    let (tx, rx) = mpsc::channel();
    view.eval_with_callback(js, move |out| {
        let _ = tx.send(out);
    })
    .map_err(|e| e.to_string())?;
    let out = rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "The page did not answer.".to_string())?;
    Ok(serde_json::from_str(&out).unwrap_or(Value::Null))
}

/// A picture of the page, as a PNG data address: the tab shows it in the
/// page's place while a menu or dialog of the app's is over it, as the
/// webview, drawn above the app, would otherwise cover that.
#[tauri::command]
pub async fn browser_picture(app: AppHandle, label: String) -> Result<String, String> {
    let view = app.get_webview(&label).ok_or(GONE)?;
    let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
    view.with_webview(move |w| picture(w, tx)).map_err(|e| e.to_string())?;
    let png = rx.recv_timeout(Duration::from_secs(5)).ok().flatten().ok_or("The page gave no picture.")?;
    Ok(format!("data:image/png;base64,{}", crate::mcp::base64(&png)))
}

#[cfg(windows)]
fn picture(w: tauri::webview::PlatformWebview, tx: mpsc::Sender<Option<Vec<u8>>>) {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream};
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG};
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    fn bytes(stream: &IStream) -> Option<Vec<u8>> {
        unsafe {
            let mut stat = STATSTG::default();
            stream.Stat(&mut stat, STATFLAG_NONAME).ok()?;
            let global = GetHGlobalFromStream(stream).ok()?;
            let at = GlobalLock(global) as *const u8;
            if at.is_null() {
                return None;
            }
            let png = std::slice::from_raw_parts(at, stat.cbSize as usize).to_vec();
            let _ = GlobalUnlock(global);
            Some(png)
        }
    }

    let done = tx.clone();
    let started = (|| unsafe {
        let core = w.controller().CoreWebView2()?;
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
        let out = stream.clone();
        let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
            let _ = done.send(result.ok().and_then(|_| bytes(&out)));
            Ok(())
        }));
        core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
    })();
    if started.is_err() {
        let _ = tx.send(None);
    }
}

#[cfg(target_os = "macos")]
fn picture(w: tauri::webview::PlatformWebview, tx: mpsc::Sender<Option<Vec<u8>>>) {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    unsafe {
        let view = &*(w.inner() as *const WKWebView);
        let config = WKSnapshotConfiguration::new(objc2::MainThreadMarker::new_unchecked());
        let done = block2::RcBlock::new(move |image: *mut NSImage, _: *mut NSError| {
            let png = image.as_ref().and_then(|image| {
                let tiff = image.TIFFRepresentation()?;
                let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
                let png = rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())?;
                Some(png.to_vec())
            });
            let _ = tx.send(png);
        });
        view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &done);
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn picture(_: tauri::webview::PlatformWebview, tx: mpsc::Sender<Option<Vec<u8>>>) {
    let _ = tx.send(None);
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, label: String) {
    if let Some(view) = app.get_webview(&label) {
        let _ = view.close();
    }
}

/// One thing a person does with a mouse or keyboard. `x` and `y` are points
/// from the top left of the webview it is done in.
#[derive(Deserialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Act {
    kind: String,
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    /// 0 the left button, 2 the right.
    #[serde(default)]
    button: u8,
    #[serde(default = "one")]
    clicks: isize,
    /// A key with its modifiers for `key` ("Enter", "cmd+a"), the characters for `text`.
    #[serde(default)]
    text: String,
}

fn one() -> isize {
    1
}

/// Does `acts` in a webview: a page from the web by its label, or the
/// window's own (where the preview's frame is) when there is none. Whether
/// the window was active: WebKit follows a hover only in one that is.
#[tauri::command]
pub async fn native_input(app: AppHandle, view: Option<String>, acts: Vec<Act>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = mpsc::channel();
        let run = move |w: tauri::webview::PlatformWebview| {
            // On the main thread: Tauri's promise for with_webview.
            let _ = tx.send(unsafe { macos::send(&*(w.inner() as *const objc2_app_kit::NSView), &acts) });
        };
        let target = app.get_webview(view.as_deref().unwrap_or("main")).ok_or(GONE)?;
        target.with_webview(run).map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "The input was not taken.".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, view, acts);
        Err("native input is macOS only".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{code_of, Act};
    use objc2::runtime::NSObjectProtocol;
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSView};
    use objc2_foundation::{NSPoint, NSProcessInfo, NSString};

    pub fn send(view: &NSView, acts: &[Act]) -> Result<bool, String> {
        let window = view.window().ok_or("The preview is not in a window.")?;
        let number = window.windowNumber();
        let start = NSProcessInfo::processInfo().systemUptime();
        let (flipped, height) = (view.isFlipped(), view.bounds().size.height);
        let at = |x: f64, y: f64| view.convertPoint_toView(NSPoint::new(x, if flipped { y } else { height - y }), None);
        // A press or a key takes the keyboard, as a person's click would; a hover does not.
        if acts.iter().any(|a| a.kind != "move") {
            window.makeFirstResponder(Some(view));
        }
        for (i, a) in acts.iter().enumerate() {
            let time = start + i as f64 * 0.001;
            match a.kind.as_str() {
                "move" | "down" | "up" | "drag" => {
                    let right = a.button == 2;
                    let kind = match a.kind.as_str() {
                        "move" => NSEventType::MouseMoved,
                        "drag" => NSEventType::LeftMouseDragged,
                        "down" if right => NSEventType::RightMouseDown,
                        "down" => NSEventType::LeftMouseDown,
                        _ if right => NSEventType::RightMouseUp,
                        _ => NSEventType::LeftMouseUp,
                    };
                    let pressure = if matches!(a.kind.as_str(), "down" | "drag") { 1.0 } else { 0.0 };
                    let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                        kind,
                        at(a.x, a.y),
                        NSEventModifierFlags::empty(),
                        time,
                        number,
                        None,
                        0,
                        a.clicks,
                        pressure,
                    )
                    .ok_or("AppKit made no mouse event.")?;
                    match kind {
                        // WKWebView has no mouseMoved: of its own (its tracking
                        // area takes moves), so a hover is given the way WebKit's
                        // tests give one: it reaches the page with the window in
                        // the back too.
                        NSEventType::MouseMoved if view.respondsToSelector(sel!(_simulateMouseMove:)) => unsafe {
                            let _: () = msg_send![view, _simulateMouseMove: &*event];
                        },
                        NSEventType::MouseMoved => window.sendEvent(&event),
                        NSEventType::LeftMouseDragged => view.mouseDragged(&event),
                        NSEventType::LeftMouseDown => view.mouseDown(&event),
                        NSEventType::RightMouseDown => view.rightMouseDown(&event),
                        NSEventType::RightMouseUp => view.rightMouseUp(&event),
                        _ => view.mouseUp(&event),
                    }
                }
                "key" => {
                    let (code, chars, flags) = combo(&a.text).ok_or_else(|| format!("Not a key: {}", a.text))?;
                    key(view, number, time, code, &chars, flags)?;
                }
                "text" => {
                    for c in a.text.chars() {
                        let (code, chars) = if c == '\n' { (36, "\r".to_string()) } else { (code_of(c), c.to_string()) };
                        key(view, number, time, code, &chars, NSEventModifierFlags::empty())?;
                    }
                }
                other => return Err(format!("Unknown input: {other}")),
            }
        }
        Ok(window.isKeyWindow())
    }

    fn key(view: &NSView, number: isize, time: f64, code: u16, chars: &str, flags: NSEventModifierFlags) -> Result<(), String> {
        let chars = NSString::from_str(chars);
        let event = |kind| {
            NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                kind,
                NSPoint::new(0.0, 0.0),
                flags,
                time,
                number,
                None,
                &chars,
                &chars,
                false,
                code,
            )
            .ok_or("AppKit made no key event.")
        };
        let down = event(NSEventType::KeyDown)?;
        view.keyDown(&down);
        // The page hears a shortcut, but the edit it stands for is the Edit
        // menu's, which acts only in the key window: done here instead, so it
        // works with the app behind others.
        if flags.contains(NSEventModifierFlags::Command) {
            let edit = match (chars.to_string().to_ascii_lowercase().as_str(), flags.contains(NSEventModifierFlags::Shift)) {
                ("a", _) => Some(sel!(selectAll:)),
                ("c", _) => Some(sel!(copy:)),
                ("x", _) => Some(sel!(cut:)),
                ("v", _) => Some(sel!(paste:)),
                ("z", false) => Some(sel!(undo:)),
                ("z", true) => Some(sel!(redo:)),
                _ => None,
            };
            if let Some(edit) = edit {
                // send() runs on the main thread (native_input).
                let app = NSApplication::sharedApplication(unsafe { MainThreadMarker::new_unchecked() });
                unsafe { app.sendAction_to_from(edit, Some(view), None) };
            }
        }
        let up = event(NSEventType::KeyUp)?;
        view.keyUp(&up);
        Ok(())
    }

    /// "Enter", "a", "shift+Tab", "cmd+a": the key code, its characters and the modifiers.
    fn combo(text: &str) -> Option<(u16, String, NSEventModifierFlags)> {
        let mut parts: Vec<&str> = text.split('+').collect();
        let name = parts.pop()?;
        let mut flags = NSEventModifierFlags::empty();
        for m in parts {
            flags |= match m.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => NSEventModifierFlags::Control,
                "shift" => NSEventModifierFlags::Shift,
                "alt" | "option" => NSEventModifierFlags::Option,
                "cmd" | "command" | "meta" | "super" => NSEventModifierFlags::Command,
                _ => return None,
            };
        }
        let (code, chars) = super::key_of(name)?;
        Some((code, chars, flags))
    }
}

/// The key code and characters AppKit gives a key, by its name or its character.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn key_of(name: &str) -> Option<(u16, String)> {
    let named = match name.to_ascii_lowercase().as_str() {
        "enter" | "return" => Some((36, "\r")),
        "tab" => Some((48, "\t")),
        "escape" | "esc" => Some((53, "\u{1b}")),
        "backspace" => Some((51, "\u{7f}")),
        "delete" => Some((117, "\u{f728}")),
        "space" => Some((49, " ")),
        "up" | "arrowup" => Some((126, "\u{f700}")),
        "down" | "arrowdown" => Some((125, "\u{f701}")),
        "left" | "arrowleft" => Some((123, "\u{f702}")),
        "right" | "arrowright" => Some((124, "\u{f703}")),
        "home" => Some((115, "\u{f729}")),
        "end" => Some((119, "\u{f72b}")),
        "pageup" => Some((116, "\u{f72c}")),
        "pagedown" => Some((121, "\u{f72d}")),
        _ => None,
    };
    if let Some((code, chars)) = named {
        return Some((code, chars.into()));
    }
    let mut it = name.chars();
    let c = it.next()?;
    it.next().is_none().then(|| (code_of(c), c.to_string()))
}

/// The key a character is on, on a US keyboard, by its position in this
/// string; 0 for one it has no key of its own for, which pages rarely read.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn code_of(c: char) -> u16 {
    const KEYS: &str = "asdfhgzxcv\0bqweryt123465=97-80]ou[ip\rlj'k;\\,/nm.\t `";
    KEYS.chars().position(|k| k == c.to_ascii_lowercase()).map_or(0, |i| i as u16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_have_their_macos_codes() {
        assert_eq!(key_of("Enter"), Some((36, "\r".into())));
        assert_eq!(key_of("a").map(|k| k.0), Some(0));
        assert_eq!(key_of("B").map(|k| k.0), Some(11));
        assert_eq!(key_of("m").map(|k| k.0), Some(46));
        assert_eq!(key_of("0").map(|k| k.0), Some(29));
        assert_eq!(key_of("`").map(|k| k.0), Some(50));
        assert_eq!(key_of("ArrowUp").map(|k| k.0), Some(126));
        assert_eq!(key_of("nope"), None);
    }

    #[test]
    fn only_web_pages_open() {
        assert!(web("https://example.com/a?b").is_ok());
        assert!(web("file:///etc/passwd").is_err());
        assert!(web("javascript:alert(1)").is_err());
    }
}
