//! A popup from a page in the app's window: the dev server's page in a
//! Preview's frame, or a frame of another site inside it, as a bank's sign-in
//! that Plaid Link opens. It opens as a window of its own, as in a browser, and
//! shares the page's session, so the page that opened it can watch it and
//! hear from it. It is given none of the app's commands (capabilities/default.json
//! names the main window only).

use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry};

static COUNT: AtomicUsize = AtomicUsize::new(0);

pub const PREFIX: &str = "popup-";

pub fn open(app: &AppHandle, url: &Url, features: NewWindowFeatures) -> NewWindowResponse<Wry> {
    if !matches!(url.scheme(), "http" | "https") && url.as_str() != "about:blank" {
        return NewWindowResponse::Deny;
    }
    let label = format!("{PREFIX}{}", COUNT.fetch_add(1, Ordering::Relaxed));
    let placed = features.position().is_some();
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External("about:blank".parse().unwrap()))
        .title(url.host_str().unwrap_or("Bluprint"))
        .inner_size(520.0, 720.0)
        .window_features(features)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        });
    if !placed {
        builder = builder.center();
    }
    if let Some(main) = app.get_webview_window("main") {
        builder = match builder.parent(&main) {
            Ok(b) => b,
            Err(_) => return NewWindowResponse::Deny,
        };
    }
    match builder.build() {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => NewWindowResponse::Deny,
    }
}
