//! The shell a terminal tab opens: the one the user's own terminal opens.

use std::path::{Path, PathBuf};

pub struct Shell {
    pub program: String,
    /// What the user's terminal starts it with, `--login -i` for Git Bash.
    pub args: Vec<String>,
}

/// The language a tab's shell reads, for the commands Blueprint types into it.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Syntax {
    Posix,
    Cmd,
    /// Windows PowerShell too, which has no `&&`.
    PowerShell,
}

impl Shell {
    /// The shell's own name, `zsh` for `/usr/bin/zsh`.
    pub fn name(&self) -> String {
        Path::new(&self.program)
            .file_stem()
            .map_or_else(|| self.program.clone(), |s| s.to_string_lossy().into_owned())
    }

    pub fn syntax(&self) -> Syntax {
        if cfg!(unix) {
            return Syntax::Posix;
        }
        match self.name().to_ascii_lowercase().as_str() {
            "cmd" => Syntax::Cmd,
            "powershell" | "pwsh" => Syntax::PowerShell,
            _ => Syntax::Posix,
        }
    }
}

impl Syntax {
    /// What a new tab's shell reads.
    pub fn of_tabs() -> Syntax {
        default().syntax()
    }

    /// One word, whatever it holds. cmd has no escape for a double quote, which no path holds on Windows.
    pub fn quote(self, s: &str) -> String {
        match self {
            Syntax::Posix => format!("'{}'", s.replace('\'', r"'\''")),
            Syntax::Cmd => format!("\"{s}\""),
            Syntax::PowerShell => format!("'{}'", s.replace('\'', "''")),
        }
    }

    pub fn path(self, p: &Path) -> String {
        self.quote(&p.to_string_lossy())
    }

    /// A program named by its path, run with what follows: PowerShell takes a quoted word for a string.
    pub fn call(self, program: &Path) -> String {
        match self {
            Syntax::PowerShell => format!("& {}", self.path(program)),
            _ => self.path(program),
        }
    }

    /// Sets a variable for the commands after it.
    pub fn set(self, name: &str, value: &str) -> String {
        match self {
            Syntax::Posix => format!("export {name}={}", self.quote(value)),
            Syntax::Cmd => format!("set \"{name}={value}\""),
            Syntax::PowerShell => format!("$env:{name} = {}", self.quote(value)),
        }
    }

    /// `dirs` ahead of PATH. Git for Windows' bash keeps PATH as `/c/...` paths.
    pub fn prepend_path(self, dirs: &[PathBuf]) -> String {
        match self {
            Syntax::Posix => {
                let dirs: Vec<String> = dirs.iter().map(|d| self.quote(&posix_path(d))).collect();
                format!("export PATH={}:\"$PATH\"", dirs.join(":"))
            }
            Syntax::Cmd => {
                let dirs: Vec<String> = dirs.iter().map(|d| d.to_string_lossy().into_owned()).collect();
                format!("set \"PATH={};%PATH%\"", dirs.join(";"))
            }
            Syntax::PowerShell => {
                let dirs: Vec<String> = dirs.iter().map(|d| format!("{};", d.to_string_lossy())).collect();
                format!("$env:PATH = {} + $env:PATH", self.quote(&dirs.concat()))
            }
        }
    }

    /// Each step once the one before it succeeded.
    pub fn all(self, steps: &[String]) -> String {
        match self {
            Syntax::PowerShell => steps.iter().rev().fold(String::new(), |rest, step| {
                if rest.is_empty() { step.clone() } else { format!("{step}; if ($?) {{ {rest} }}") }
            }),
            _ => steps.join(" && "),
        }
    }

    /// `all(steps)`, then 0 written to `done` when every step succeeded, 1 otherwise.
    pub fn all_then_write(self, steps: &[String], done: &Path) -> String {
        let done = self.path(done);
        match self {
            Syntax::PowerShell => {
                let mut steps = steps.to_vec();
                steps.push("$ok = $true".into());
                format!("$ok = $false; {}; Set-Content -Encoding ascii -Path {done} -Value $(if ($ok) {{ 0 }} else {{ 1 }})", self.all(&steps))
            }
            _ => format!("{} && echo 0 > {done} || echo 1 > {done}", self.all(steps)),
        }
    }
}

/// A Windows path as Git for Windows' bash names it, `C:\x` as `/c/x`.
fn posix_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    if !cfg!(windows) {
        return s.into_owned();
    }
    match s.as_bytes() {
        [drive, b':', ..] if drive.is_ascii_alphabetic() => format!("/{}{}", (*drive as char).to_ascii_lowercase(), s[2..].replace('\\', "/")),
        _ => s.replace('\\', "/"),
    }
}

/// The login shell.
#[cfg(not(windows))]
pub fn default() -> Shell {
    Shell { program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()), args: Vec::new() }
}

/// Windows Terminal's default profile, when it is a shell Blueprint's launchers
/// run in; Windows PowerShell, Windows Terminal's own default, otherwise.
#[cfg(windows)]
pub fn default() -> Shell {
    windows_terminal::default().unwrap_or_else(|| Shell { program: "powershell.exe".into(), args: Vec::new() })
}

#[cfg(windows)]
mod windows_terminal {
    use super::Shell;
    use serde_json::Value;
    use std::path::{Path, PathBuf};

    const POWERSHELL: &str = "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}";
    const CMD: &str = "{0caa0dad-35be-5f56-a8ff-afceeeaa6101}";
    const SETTINGS: [&str; 3] = [
        r"Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json",
        r"Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json",
        r"Microsoft\Windows Terminal\settings.json",
    ];

    pub fn default() -> Option<Shell> {
        let local = PathBuf::from(std::env::var_os("LOCALAPPDATA")?);
        let text = SETTINGS.iter().find_map(|p| std::fs::read_to_string(local.join(p)).ok())?;
        let settings: Value = serde_json::from_str(&plain_json(&text)).ok()?;
        let shell = locate(from_settings(&settings)?)?;
        runs_launchers(Path::new(&shell.program)).then_some(shell)
    }

    /// The program found on disk, its path's words taken back from the arguments when it
    /// was written unquoted, `C:\Program Files\Git\bin\bash.exe --login -i`, as Windows
    /// Terminal takes them.
    pub(super) fn locate(shell: Shell) -> Option<Shell> {
        let words: Vec<String> = std::iter::once(shell.program).chain(shell.args).collect();
        (1..=words.len()).find_map(|n| {
            let program = resolve(&words[..n].join(" "))?;
            Some(Shell { program: program.to_string_lossy().into_owned(), args: words[n..].to_vec() })
        })
    }

    pub(super) fn from_settings(settings: &Value) -> Option<Shell> {
        let wanted = settings["defaultProfile"].as_str().unwrap_or(POWERSHELL);
        let list = settings["profiles"]["list"].as_array().or(settings["profiles"].as_array());
        let is = |p: &&Value, key: &str| p[key].as_str().is_some_and(|v| v.eq_ignore_ascii_case(wanted));
        let profile = list.and_then(|l| l.iter().find(|p| is(p, "guid")).or_else(|| l.iter().find(|p| is(p, "name"))));
        if let Some(line) = profile.and_then(|p| p["commandline"].as_str()) {
            return split(&expand(line));
        }
        let guid = profile.and_then(|p| p["guid"].as_str()).unwrap_or(wanted);
        let plain = |p: &str| Some(Shell { program: p.into(), args: Vec::new() });
        match profile.and_then(|p| p["source"].as_str()) {
            Some("Windows.Terminal.PowershellCore") => plain("pwsh.exe"),
            Some("Git") => Some(Shell {
                program: crate::claude::git_bash()?.to_string_lossy().into_owned(),
                args: vec!["--login".into(), "-i".into()],
            }),
            Some(_) => None,
            None if guid.eq_ignore_ascii_case(POWERSHELL) => plain("powershell.exe"),
            None if guid.eq_ignore_ascii_case(CMD) => plain("cmd.exe"),
            None => None,
        }
    }

    /// cmd, PowerShell, and Git for Windows' bash; not WSL's `bash.exe` in System32,
    /// whose Linux cannot run the launchers.
    fn runs_launchers(program: &Path) -> bool {
        let name = program.file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        let system = std::env::var_os("SystemRoot").map(|r| PathBuf::from(r).join("System32"));
        let in_system = system.is_some_and(|s| program.parent().is_some_and(|p| p.as_os_str().eq_ignore_ascii_case(s.as_os_str())));
        match name.as_str() {
            "cmd" | "powershell" | "pwsh" => true,
            "bash" | "sh" | "zsh" => !in_system,
            _ => false,
        }
    }

    fn resolve(program: &str) -> Option<PathBuf> {
        let p = Path::new(program);
        let with_exe = |p: &Path| if p.extension().is_some() { p.to_path_buf() } else { p.with_extension("exe") };
        if p.components().count() > 1 {
            return Some(with_exe(p)).filter(|p| p.is_file());
        }
        std::env::split_paths(&std::env::var_os("PATH")?).map(|d| with_exe(&d.join(p))).find(|p| p.is_file())
    }

    /// `%SystemRoot%` and the like, as Windows Terminal reads them.
    pub(super) fn expand(line: &str) -> String {
        let mut out = String::new();
        let mut rest = line;
        while let Some(start) = rest.find('%') {
            out.push_str(&rest[..start]);
            let after = &rest[start + 1..];
            match after.find('%').map(|end| (end, std::env::var(&after[..end]))) {
                Some((end, Ok(value))) => {
                    out.push_str(&value);
                    rest = &after[end + 1..];
                }
                _ => {
                    out.push('%');
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }

    /// A command line into its program and arguments, quotes kept together.
    pub(super) fn split(line: &str) -> Option<Shell> {
        let mut words = Vec::new();
        let mut word = String::new();
        let mut quoted = false;
        let mut started = false;
        for c in line.chars() {
            match c {
                '"' => {
                    quoted = !quoted;
                    started = true;
                }
                c if c.is_whitespace() && !quoted => {
                    if started {
                        words.push(std::mem::take(&mut word));
                        started = false;
                    }
                }
                c => {
                    word.push(c);
                    started = true;
                }
            }
        }
        if started {
            words.push(word);
        }
        let mut words = words.into_iter();
        Some(Shell { program: words.next()?, args: words.collect() })
    }

    /// Windows Terminal's settings allow comments and trailing commas; JSON does not.
    pub(super) fn plain_json(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    out.push(c);
                    while let Some(s) = chars.next() {
                        out.push(s);
                        match s {
                            '\\' => out.extend(chars.next()),
                            '"' => break,
                            _ => {}
                        }
                    }
                }
                '/' if chars.peek() == Some(&'/') => {
                    while chars.next_if(|&n| n != '\n').is_some() {}
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    let mut last = ' ';
                    for n in chars.by_ref() {
                        if last == '*' && n == '/' {
                            break;
                        }
                        last = n;
                    }
                }
                '}' | ']' => {
                    let kept = out.trim_end().len();
                    if out[..kept].ends_with(',') {
                        out.truncate(kept - 1);
                    }
                    out.push(c);
                }
                c => out.push(c),
            }
        }
        out
    }
}

#[cfg(test)]
mod syntax_tests {
    use super::Syntax;
    use std::path::Path;

    fn steps() -> Vec<String> {
        vec!["cd 'app'".into(), "npm run dev".into()]
    }

    #[test]
    fn steps_run_in_turn_in_every_shell() {
        assert_eq!(Syntax::Posix.all(&steps()), "cd 'app' && npm run dev");
        assert_eq!(Syntax::Cmd.all(&steps()), "cd 'app' && npm run dev");
        assert_eq!(Syntax::PowerShell.all(&steps()), "cd 'app'; if ($?) { npm run dev }");
    }

    #[test]
    fn a_run_writes_how_it_ended_in_every_shell() {
        let done = Path::new("d");
        assert_eq!(Syntax::Cmd.all_then_write(&steps(), done), "cd 'app' && npm run dev && echo 0 > \"d\" || echo 1 > \"d\"");
        assert_eq!(
            Syntax::PowerShell.all_then_write(&steps(), done),
            "$ok = $false; cd 'app'; if ($?) { npm run dev; if ($?) { $ok = $true } }; Set-Content -Encoding ascii -Path 'd' -Value $(if ($ok) { 0 } else { 1 })"
        );
    }

    #[test]
    fn words_and_variables_in_every_shell() {
        assert_eq!(Syntax::Posix.quote("it's"), r"'it'\''s'");
        assert_eq!(Syntax::PowerShell.quote("it's"), "'it''s'");
        assert_eq!(Syntax::Posix.set("PORT", "3001"), "export PORT='3001'");
        assert_eq!(Syntax::Cmd.set("PORT", "3001"), "set \"PORT=3001\"");
        assert_eq!(Syntax::PowerShell.set("PORT", "3001"), "$env:PORT = '3001'");
        assert_eq!(Syntax::PowerShell.call(Path::new("g.bat")), "& 'g.bat'");
    }

    #[cfg(windows)]
    #[test]
    fn git_bash_names_windows_paths_its_own_way() {
        assert_eq!(super::posix_path(Path::new(r"C:\Users\me\sdk")), "/c/Users/me/sdk");
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::windows_terminal::*;

    #[test]
    fn windows_terminal_settings_with_comments_and_trailing_commas_read_as_json() {
        let text = "{\n // a \"note\"\n \"a\": \"x // y\", /* b */ \"c\": [1, 2,],\n}";
        let v: serde_json::Value = serde_json::from_str(&plain_json(text)).unwrap();
        assert_eq!(v, serde_json::json!({ "a": "x // y", "c": [1, 2] }));
    }

    #[test]
    fn the_default_profile_names_its_shell() {
        let settings = serde_json::json!({
            "defaultProfile": "{d9e8b268-3e12-4c26-a473-85b0d008dbe5}",
            "profiles": { "list": [
                { "guid": "{61c54bbd-c2c6-5271-96e7-009a87ff44bf}", "name": "Windows PowerShell" },
                { "guid": "{d9e8b268-3e12-4c26-a473-85b0d008dbe5}", "name": "Git Bash", "commandline": "\"C:\\Program Files\\Git\\bin\\bash.exe\" --login -i" },
            ] }
        });
        let shell = from_settings(&settings).unwrap();
        assert_eq!(shell.program, r"C:\Program Files\Git\bin\bash.exe");
        assert_eq!(shell.args, ["--login", "-i"]);
    }

    #[test]
    fn an_unquoted_program_path_with_spaces_is_found() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("Program Files").join("bash.exe");
        std::fs::create_dir_all(program.parent().unwrap()).unwrap();
        std::fs::write(&program, "").unwrap();
        let shell = locate(split(&format!("{} --login -i", program.display())).unwrap()).unwrap();
        assert_eq!(shell.program, program.to_string_lossy());
        assert_eq!(shell.args, ["--login", "-i"]);
    }

    #[test]
    fn no_default_profile_is_windows_powershell() {
        let shell = from_settings(&serde_json::json!({ "profiles": { "list": [] } })).unwrap();
        assert_eq!(shell.program, "powershell.exe");
    }

    #[test]
    fn a_command_line_expands_its_variables() {
        let root = std::env::var("SystemRoot").unwrap();
        assert_eq!(expand(r"%SystemRoot%\System32\cmd.exe %nope%"), format!(r"{root}\System32\cmd.exe %nope%"));
    }
}
