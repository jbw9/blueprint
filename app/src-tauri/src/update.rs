//! Swaps in the release the server staged in `<app_data_dir>/update` (app/scripts/update.mjs): its
//! server over `server/`, its app over this one. Done once Blueprint has quit, or as it starts if it
//! last ended without quitting, so neither is replaced while it runs. "Restart to update" quits,
//! swaps and opens the new one.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

static EXE: OnceLock<PathBuf> = OnceLock::new();
static RELAUNCH: AtomicBool = AtomicBool::new(false);

/// Read before anything replaces it: Linux names a replaced executable "… (deleted)".
pub fn remember_exe() {
    if let Ok(p) = std::env::current_exe() {
        let _ = EXE.set(p);
    }
}

/// The app's data folder as Tauri's `app_data_dir` has it, for `--apply-update`, which runs without one.
pub fn data_dir() -> Option<PathBuf> {
    let base: PathBuf = if cfg!(target_os = "macos") {
        crate::proc::home()?.join("Library/Application Support")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA")?.into()
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| crate::proc::home().map(|h| h.join(".local/share")))?
    };
    Some(base.join("dev.blueprint.app"))
}

/// The `.app` folder an executable runs from, on macOS.
fn bundle(exe: &Path) -> Option<PathBuf> {
    let app = exe.parent()?.parent()?.parent()?;
    (app.extension()? == "app").then(|| app.to_path_buf())
}

/// What a swap left: the server it moved aside (put back, if it never got a new one), and the app it replaced.
pub fn sweep(data: &Path) {
    let (server, old) = (data.join("server"), data.join("server.old"));
    if !server.exists() && old.exists() {
        let _ = std::fs::rename(&old, &server);
    }
    let _ = std::fs::remove_dir_all(&old);
    if let Some(exe) = EXE.get() {
        let _ = std::fs::remove_file(exe.with_file_name("blueprint.old.exe"));
        if let Some(app) = bundle(exe) {
            let _ = std::fs::remove_dir_all(app.with_file_name("Blueprint.app.old"));
        }
    }
}

/// Windows frees a killed server's open files a moment after it ends, and until then its folder can't move.
fn rename(from: &Path, to: &Path) -> Result<(), String> {
    for _ in 0..10 {
        if std::fs::rename(from, to).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    std::fs::rename(from, to).map_err(|e| format!("Couldn't move {} to {}: {e}", from.display(), to.display()))
}

/// Swaps in the staged release, if there is one; whether the app itself was replaced. The app goes
/// first: if it can't be, nothing changes and the update stays staged for next time.
pub fn apply(data: &Path) -> Result<bool, String> {
    let staged = data.join("update");
    if !staged.join("server").exists() {
        return Ok(false);
    }
    let replaced = match EXE.get() {
        Some(exe) => replace_app(exe, &staged)?,
        None => false,
    };
    let (server, old) = (data.join("server"), data.join("server.old"));
    let _ = std::fs::remove_dir_all(&old);
    if server.exists() {
        rename(&server, &old)?;
    }
    if let Err(e) = rename(&staged.join("server"), &server) {
        let _ = std::fs::rename(&old, &server);
        return Err(e);
    }
    let _ = std::fs::remove_dir_all(&old);
    let _ = std::fs::remove_dir_all(&staged);
    Ok(replaced)
}

#[cfg(target_os = "macos")]
fn replace_app(exe: &Path, staged: &Path) -> Result<bool, String> {
    let new = staged.join("bundle/macos/Blueprint.app");
    let Some(app) = bundle(exe).filter(|_| new.exists()) else { return Ok(false) };
    let old = app.with_file_name("Blueprint.app.old");
    let _ = std::fs::remove_dir_all(&old);
    rename(&app, &old)?;
    // The data folder and /Applications can be on different volumes, where a folder can't be renamed across.
    let copied = || Command::new("ditto").arg(&new).arg(&app).status().is_ok_and(|s| s.success());
    if std::fs::rename(&new, &app).is_err() && !copied() {
        let _ = std::fs::remove_dir_all(&app);
        let _ = std::fs::rename(&old, &app);
        return Err(format!("Couldn't replace {}.", app.display()));
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(true)
}

#[cfg(windows)]
fn replace_app(exe: &Path, staged: &Path) -> Result<bool, String> {
    let new = staged.join("blueprint.exe");
    if !new.exists() {
        return Ok(false);
    }
    // A running exe can't be written over, but it can be moved aside; `sweep` deletes it next launch.
    let old = exe.with_file_name("blueprint.old.exe");
    let _ = std::fs::remove_file(&old);
    rename(exe, &old)?;
    if let Err(e) = std::fs::copy(&new, exe) {
        let _ = std::fs::rename(&old, exe);
        return Err(format!("Couldn't replace {}: {e}", exe.display()));
    }
    Ok(true)
}

#[cfg(target_os = "linux")]
fn replace_app(exe: &Path, staged: &Path) -> Result<bool, String> {
    let new = staged.join("blueprint");
    if !new.exists() {
        return Ok(false);
    }
    // Beside the running executable, then over it: one can't be written in place.
    let tmp = exe.with_file_name(".blueprint.new");
    std::fs::copy(&new, &tmp).map_err(|e| format!("Couldn't copy {}: {e}", new.display()))?;
    rename(&tmp, exe)?;
    Ok(true)
}

/// Opens Blueprint again, once this one has quit and swapped.
pub fn relaunch() {
    let Some(exe) = EXE.get() else { return };
    if let Some(app) = bundle(exe) {
        let _ = Command::new("open").arg("-n").arg(app).spawn();
    } else {
        let _ = Command::new(exe).spawn();
    }
}

/// When Blueprint quits: the staged release goes in, and the new one opens if "Restart to update" asked.
pub fn on_exit(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(data) = app.path().app_data_dir() {
        if let Err(e) = apply(&data) {
            eprintln!("update: {e}");
        }
    }
    if RELAUNCH.load(Ordering::SeqCst) {
        relaunch();
    }
}

/// "Restart to update" in the status bar.
#[tauri::command]
pub fn update_restart(app: tauri::AppHandle) {
    RELAUNCH.store(true, Ordering::SeqCst);
    app.exit(0);
}
