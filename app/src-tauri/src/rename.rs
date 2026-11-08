//! The folders the app kept while it was called Bluprint (`dev.bluprint.app`):
//! its data, its webview's storage and its caches. Before the server or the
//! window opens, what each holds is merged into the folder of the same kind
//! under the new identifier. A file already in the new folder wins; what could
//! not move (a file held open) stays, and moves on a later launch.

use std::path::{Path, PathBuf};

const OLD: &str = "dev.bluprint.app";

/// The old app's own server snapshot (server.rs, scripts/install-app.sh): the
/// new install builds its own, so the old one is dropped, not merged.
const REBUILT: &[&str] = &["server", "server-next", "server.old"];

pub fn migrate(app: &tauri::AppHandle) {
    use tauri::Manager;
    // A Bluprint still open is writing to its folders; they move once it is closed.
    if std::net::TcpStream::connect_timeout(&([127, 0, 0, 1], crate::server::PORT).into(), std::time::Duration::from_millis(300)).is_ok() {
        return;
    }
    let p = app.path();
    let mut dirs: Vec<PathBuf> = [p.app_data_dir(), p.app_local_data_dir(), p.app_config_dir(), p.app_cache_dir()]
        .into_iter()
        .flatten()
        .collect();
    #[cfg(target_os = "macos")]
    if let Some(h) = crate::proc::home() {
        let id = &app.config().identifier;
        dirs.push(h.join("Library/WebKit").join(id));
        dirs.push(h.join("Library/HTTPStorages").join(id));
    }
    dirs.sort();
    dirs.dedup();
    for to in dirs {
        if let Some(from) = to.parent().map(|d| d.join(OLD)) {
            for name in REBUILT {
                let _ = std::fs::remove_dir_all(from.join(name));
            }
            merge(&from, &to);
        }
    }
}

/// Moves everything in `from` into `to`, folder into folder, and removes each
/// folder of `from` it empties.
fn merge(from: &Path, to: &Path) {
    let Ok(entries) = std::fs::read_dir(from) else { return };
    if std::fs::create_dir_all(to).is_err() {
        return;
    }
    for e in entries.flatten() {
        let dest = to.join(e.file_name());
        if !dest.exists() {
            let _ = std::fs::rename(e.path(), &dest);
        } else if dest.is_dir() && e.path().is_dir() {
            merge(&e.path(), &dest);
        }
    }
    let _ = std::fs::remove_dir(from);
}

#[cfg(test)]
mod tests {
    use super::merge;
    use std::fs;

    #[test]
    fn merges_folders_keeps_newer_and_leaves_conflicts() {
        let t = tempfile::tempdir().unwrap();
        let (old, new) = (t.path().join("old"), t.path().join("new"));
        fs::create_dir_all(old.join("projects/a")).unwrap();
        fs::create_dir_all(old.join("projects/b")).unwrap();
        fs::write(old.join("projects.json"), "old").unwrap();
        fs::write(old.join("projects/a/blueprint.json"), "a").unwrap();
        fs::write(old.join("projects/b/blueprint.json"), "b-old").unwrap();
        fs::create_dir_all(new.join("projects/b")).unwrap();
        fs::write(new.join("projects/b/blueprint.json"), "b-new").unwrap();

        merge(&old, &new);

        assert_eq!(fs::read_to_string(new.join("projects.json")).unwrap(), "old");
        assert_eq!(fs::read_to_string(new.join("projects/a/blueprint.json")).unwrap(), "a");
        assert_eq!(fs::read_to_string(new.join("projects/b/blueprint.json")).unwrap(), "b-new");
        assert!(old.join("projects/b/blueprint.json").exists());
        assert!(!old.join("projects/a").exists());

        fs::remove_file(old.join("projects/b/blueprint.json")).unwrap();
        merge(&old, &new);
        assert!(!old.exists());
    }

    #[test]
    fn a_missing_old_folder_is_nothing_to_do() {
        let t = tempfile::tempdir().unwrap();
        merge(&t.path().join("none"), &t.path().join("new"));
        assert!(!t.path().join("new").exists());
    }
}
