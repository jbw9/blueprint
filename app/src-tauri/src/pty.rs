//! The workspace's tabs. Each one is a real pty running the user's shell in the
//! open blueprint's checkout; its output streams to the webview over a `Channel` as
//! raw bytes (xterm decodes UTF-8 itself, so a character split across two
//! reads is fine), and one final JSON `{"exit": code}` says it ended.
//!
//! A tab can start Claude Code in the shell first (claude.rs), and Claude can
//! be started again in any tab. Every tab owns a context queue for it,
//! removed with the tab.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::claude;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Where picks wait for the next prompt to Claude in this tab.
    context: PathBuf,
    #[cfg(windows)]
    job: Option<Job>,
}

impl Pty {
    fn new(master: Box<dyn MasterPty + Send>, writer: Box<dyn Write + Send>, child: Box<dyn Child + Send + Sync>, context: PathBuf) -> Self {
        #[cfg(windows)]
        let job = child.as_raw_handle().and_then(Job::holding);
        Pty {
            master,
            writer,
            child,
            context,
            #[cfg(windows)]
            job,
        }
    }

    /// Blocks until the console is gone, so never on the main thread.
    fn end(mut self) {
        #[cfg(windows)]
        drop(self.job.take());
        let _ = self.child.kill();
        // A Windows console opens by asking the terminal where its cursor is
        // (portable-pty inherits the cursor), and does nothing, closing included,
        // until it is told. A tab ended before xterm answered would never close;
        // this answers for it, to a console with no program left to read it.
        #[cfg(windows)]
        let _ = self.writer.write_all(b"[1;1R").and_then(|()| self.writer.flush());
        claude::forget(&self.context);
    }

    /// Ends `ptys` on a thread of their own.
    fn end_apart(ptys: Vec<Pty>) {
        if !ptys.is_empty() {
            std::thread::spawn(move || ptys.into_iter().for_each(Pty::end));
        }
    }
}

/// Everything a tab's shell started, Claude's own processes too. A Windows
/// console stays open while any program is still attached to it, and closing
/// it waits for that; so the whole tree goes with the shell, and with the app
/// should it die.
#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
unsafe impl Sync for Job {}

#[cfg(windows)]
impl Job {
    fn holding(process: std::os::windows::io::RawHandle) -> Option<Job> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let job = Job(CreateJobObjectW(std::ptr::null(), std::ptr::null()));
            if job.0.is_null() {
                return None;
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set = SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            );
            (set != 0 && AssignProcessToJobObject(job.0, process as _) != 0).then_some(job)
        }
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[derive(Default)]
pub struct Ptys {
    next: AtomicU32,
    open: Arc<Mutex<HashMap<u32, Pty>>>,
}

impl Ptys {
    /// Every shell still running, ended. Called when the app exits, so
    /// closing the window never leaves a shell behind.
    pub fn kill_all(&self) {
        let all = self.open.lock().unwrap().drain().map(|(_, p)| p).collect();
        Pty::end_apart(all);
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

fn shell() -> String {
    #[cfg(windows)]
    return std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into());
    #[cfg(not(windows))]
    return std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
}

/// What the tab is called: the shell's own name, `zsh` for `/usr/bin/zsh`.
#[derive(serde::Serialize)]
pub struct Spawned {
    id: u32,
    shell: String,
}

/// `outline` is the open blueprint's sections, so Claude in this tab can name one it
/// was not handed (claude.rs's LIST).
#[tauri::command]
pub fn pty_spawn(
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    launch: Option<claude::Launch>,
    start_claude: bool,
    resume: Option<String>,
    cwd: Option<String>,
    outline: Option<String>,
    ptys: tauri::State<Ptys>,
) -> Result<Spawned, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let id = ptys.next.fetch_add(1, Ordering::Relaxed) + 1;
    let context = claude::queue(id);
    let program = shell();
    let name = std::path::Path::new(&program)
        .file_stem()
        .map_or_else(|| program.clone(), |s| s.to_string_lossy().into_owned());
    let mut cmd = CommandBuilder::new(&program);
    // A Mac app opened from Finder gets a bare PATH; Terminal.app's shells are
    // login shells, and only those read /etc/zprofile (path_helper, which adds
    // /usr/local/bin) and ~/.zprofile (Homebrew's shellenv).
    let login = cfg!(target_os = "macos");
    if login {
        cmd.arg("-l");
    }
    // With Claude found, the launcher works in this tab; asked to, Claude runs
    // first and the user's ordinary interactive shell takes over when it exits.
    if let Some(launch) = &launch {
        claude::prepare(&mut cmd, launch, &context, outline.as_deref(), id).map_err(|e| e.to_string())?;
        if start_claude {
            if cfg!(unix) {
                cmd.args(["-c", if login { r#""$BLUEPRINT_LAUNCHER"; exec "$SHELL" -l"# } else { r#""$BLUEPRINT_LAUNCHER"; exec "$SHELL""# }]);
                cmd.env("SHELL", &program);
                if let Some(id) = &resume {
                    claude::resuming(&context, id).map_err(|e| e.to_string())?;
                }
            } else if name.eq_ignore_ascii_case("cmd") {
                cmd.args(["/k", "blueprint-claude"]);
            } else {
                cmd.args(["-NoExit", "-Command", "blueprint-claude"]);
            }
        }
    }
    // The checkout the page named, if it is really there; home otherwise.
    let dir = cwd.map(PathBuf::from).filter(|d| d.is_dir());
    if let Some(dir) = dir.or_else(crate::proc::home) {
        cmd.cwd(dir);
    }
    // An app started from a Claude Code session would hand down its markers,
    // and a Claude in a tab would then take itself for a child of that one.
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE_CHILD_SESSION");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // The slave end belongs to the shell now; holding it here would keep the
    // reader below from ever seeing EOF.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    ptys.open.lock().unwrap().insert(id, Pty::new(pair.master, writer, child, context));

    let open = ptys.open.clone();
    // Reads go to a second thread that sends them on. Claude Code redraws in
    // many small writes; whatever piles up while one send is crossing to the
    // webview goes in the next as one message, rather than a message per read.
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        while let Ok(mut chunk) = rx.recv() {
            while let Ok(more) = rx.try_recv() {
                chunk.extend_from_slice(&more);
            }
            if on_data.send(InvokeResponseBody::Raw(chunk)).is_err() {
                break;
            }
        }
        // Gone from the blueprint already if it was killed from the UI.
        let ended = open.lock().unwrap().remove(&id);
        let code = ended
            .and_then(|mut p| {
                claude::forget(&p.context);
                p.child.wait().ok()
            })
            .map_or(0, |s| s.exit_code());
        let _ = on_data.send(InvokeResponseBody::Json(format!(r#"{{"exit":{code}}}"#)));
    });
    Ok(Spawned { id, shell: name })
}

fn with<T>(ptys: &Ptys, id: u32, f: impl FnOnce(&mut Pty) -> std::io::Result<T>) -> Result<T, String> {
    let mut open = ptys.open.lock().unwrap();
    let p = open.get_mut(&id).ok_or("no such terminal")?;
    f(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write(id: u32, data: String, ptys: tauri::State<Ptys>) -> Result<(), String> {
    with(&ptys, id, |p| {
        p.writer.write_all(data.as_bytes())?;
        p.writer.flush()
    })
}

#[tauri::command]
pub fn pty_resize(id: u32, cols: u16, rows: u16, ptys: tauri::State<Ptys>) -> Result<(), String> {
    with(&ptys, id, |p| p.master.resize(size(cols, rows)).map_err(std::io::Error::other))
}

#[tauri::command]
pub fn pty_kill(id: u32, ptys: tauri::State<Ptys>) -> Result<(), String> {
    let ended = ptys.open.lock().unwrap().remove(&id);
    Pty::end_apart(ended.into_iter().collect());
    Ok(())
}

/// Which of `names` the user's shell can run, found the way their own
/// terminal finds them: an interactive shell, so PATH set in its rc counts.
/// Only plain names are asked about, never anything the shell would parse.
fn which(names: Vec<String>) -> Vec<String> {
    let names: Vec<String> = names
        .into_iter()
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .collect();
    if names.is_empty() {
        return Vec::new();
    }
    runnable(names)
}

/// Windows' own lookup: PATH and PATHEXT, as cmd and PowerShell use them.
#[cfg(windows)]
fn runnable(names: Vec<String>) -> Vec<String> {
    names.into_iter().filter(|n| !crate::proc::where_is(n).is_empty()).collect()
}

#[cfg(not(windows))]
fn runnable(names: Vec<String>) -> Vec<String> {
    let script = names
        .iter()
        .map(|n| format!("command -v {n} >/dev/null 2>&1 && echo {n}"))
        .collect::<Vec<_>>()
        .join("; ");
    let out = std::process::Command::new(shell())
        .args(["-ic", &script])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output();
    let text = out.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    // An rc may print its own lines too; only exact names count.
    names.into_iter().filter(|n| text.lines().any(|l| l.trim() == n)).collect()
}

/// The coding agents a tab can start besides Claude. Async so the shell's
/// start-up never blocks the window.
#[tauri::command]
pub async fn pty_which(names: Vec<String>) -> Vec<String> {
    which(names)
}

/// A tab's queue.
fn queue_of(ptys: &Ptys, id: u32) -> Result<PathBuf, String> {
    Ok(ptys.open.lock().unwrap().get(&id).ok_or("no such terminal")?.context.clone())
}

/// What is in front in a tab: Claude through the launcher (able to take
/// context), or some other program the shell started, or the shell itself,
/// waiting at its prompt.
#[derive(serde::Serialize)]
pub struct State {
    claude: bool,
    busy: bool,
    /// What Claude is doing: `working`, `waiting` for the user, or `done`.
    status: Option<String>,
    /// Claude finished a turn the blueprint should follow; reported once.
    turn: Option<claude::Turn>,
    /// The transcript of the turn Claude just finished, whatever it did, so the
    /// app can offer to keep the answer on the blueprint; reported once.
    ended: Option<String>,
    /// What Claude asked the app to show — a section, a diff — taken mid-turn
    /// so the user is looking at it while the answer streams; reported once.
    acts: Vec<claude::Act>,
    /// A plan Claude is waiting to have accepted; reported once.
    plan: Option<claude::Plan>,
    /// The plan was accepted; reported once.
    approved: bool,
    /// The accepted plan's steps as Claude has marked them; every poll.
    steps: Vec<claude::Step>,
    /// The conversation Claude is having, to resume it after a restart.
    session: Option<String>,
}

#[tauri::command]
pub fn pty_state(id: u32, ptys: tauri::State<Ptys>) -> Result<State, String> {
    let open = ptys.open.lock().unwrap();
    let p = open.get(&id).ok_or("no such terminal")?;
    // An interactive shell gives each command its own process group, and
    // hands it the terminal: someone else leading the foreground group means
    // a program is running.
    #[cfg(unix)]
    let busy = match (p.master.process_group_leader(), p.child.process_id()) {
        (Some(front), Some(shell)) => front as u32 != shell,
        _ => false,
    };
    #[cfg(not(unix))]
    let busy = false;
    Ok(State {
        claude: claude::running(&p.context),
        busy,
        status: claude::status_of(&p.context),
        turn: claude::take_turn(&p.context),
        ended: claude::take_ended(&p.context),
        acts: claude::take_acts(&p.context),
        plan: claude::take_plan(&p.context),
        approved: claude::take_approved(&p.context),
        steps: claude::steps_of(&p.context),
        session: claude::session_of(&p.context),
    })
}

/// Queues a section for the next prompt to Claude in this tab.
#[tauri::command]
pub fn context_add(id: u32, text: String, ptys: tauri::State<Ptys>) -> Result<(), String> {
    claude::append(&queue_of(&ptys, id)?, &text).map_err(|e| e.to_string())
}

/// Rewrites what is still waiting, after a pick is taken back. Empty clears it.
#[tauri::command]
pub fn context_set(id: u32, text: String, ptys: tauri::State<Ptys>) -> Result<(), String> {
    claude::replace(&queue_of(&ptys, id)?, &text).map_err(|e| e.to_string())
}

/// Where the user is on the blueprint, for every prompt to say (claude::place).
#[tauri::command]
pub fn context_where(id: u32, text: String, ptys: tauri::State<Ptys>) -> Result<(), String> {
    claude::place(&queue_of(&ptys, id)?, &text).map_err(|e| e.to_string())
}

/// True while something queued has not gone out with a prompt yet.
#[tauri::command]
pub fn context_pending(id: u32, ptys: tauri::State<Ptys>) -> Result<bool, String> {
    Ok(claude::pending(&queue_of(&ptys, id)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tab_ended_while_a_program_runs_in_it_lets_go_at_once() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut cmd = CommandBuilder::new(shell());
        #[cfg(windows)]
        cmd.args(["/k", "ping", "-t", "127.0.0.1"]);
        #[cfg(unix)]
        cmd.args(["-c", "sleep 600"]);
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while reader.read(&mut buf).is_ok_and(|n| n > 0) {}
        });
        let writer = pair.master.take_writer().unwrap();
        let pty = Pty::new(pair.master, writer, child, std::env::temp_dir().join("blueprint-test-context.md"));
        std::thread::sleep(std::time::Duration::from_secs(2));
        let (done, ended) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            pty.end();
            let _ = done.send(());
        });
        assert!(ended.recv_timeout(std::time::Duration::from_secs(10)).is_ok(), "ending the shell hung");
    }

    #[cfg(unix)]
    #[test]
    fn which_finds_only_plain_names_the_shell_can_run() {
        let asked = ["sh", "surely-not-a-program-xyz", "sh; echo oops", ""].map(String::from).to_vec();
        assert_eq!(which(asked), vec!["sh".to_string()]);
    }
}
