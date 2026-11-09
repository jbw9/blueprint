//! Codex, OpenCode and Pi in the workspace's tabs, taking the blueprint as Claude
//! does (claude.rs): each runs through a launcher, `blueprint-<agent>`, that keeps
//! the tab's `.live` marker (naming the agent) while it runs, so picks go to it, and
//! starts it with the blueprint's instructions, the preview's tools (mcp.rs) and
//! hooks of its own kind. The hooks all go through one script, `blueprint-hook`,
//! which writes the same files beside the tab's queue as Claude's hooks do: the
//! context each prompt takes, the status dot, and the turn the blueprint follows.
//!
//! - Codex: hooks and MCP passed with `-c`. Codex runs a hook only once it is
//!   trusted, recorded in the user's config.toml; the launcher asks the app to
//!   trust these (`trust_codex`), as Codex's own `/hooks` would.
//! - OpenCode: a plugin, MCP and the instructions, in `OPENCODE_CONFIG_CONTENT`.
//! - Pi: an extension (`-e`); Pi has no MCP, so the extension offers the preview's
//!   tools as its own, each call going to the same server.
//!
//! Plans, the plan's checklist, resuming after a restart and Blueprint credit stay
//! Claude's: they rest on Claude Code's plan mode, sessions and Bedrock mode.

use portable_pty::CommandBuilder;
use std::path::Path;

/// Finds an agent's own binary on PATH, past the shims beside the launchers.
macro_rules! real {
    () => {
        r#"real() { ( IFS=:; for d in $PATH; do [ "$d" = "$BLUEPRINT_BIN" ] && continue; [ -f "$d/$1" ] && [ -x "$d/$1" ] && { printf '%s\n' "$d/$1"; exit 0; }; done; exit 1 ); }
"#
    };
}

/// What every agent's hooks run. `prompt` prints what the prompt takes (claude.rs's
/// HOOK: where the user is, then the picks) and marks the agent working; `stop` ends
/// the turn, and hands the blueprint a turn to follow when it may have edited code or
/// found the blueprint wrong. A turn carries no transcript: the blueprint reads only
/// Claude Code's.
pub fn hook_script() -> String {
    format!(
        r#"#!/bin/sh
# What Codex, OpenCode and Pi in a Blueprint tab report (src-tauri/src/agents.rs).
f="$BLUEPRINT_CONTEXT"; [ -n "$f" ] || exit 0
case "$1" in
prompt)
  printf working > "$f.status"
  [ "$2" = json ] || {{ ( {hook} ); exit 0; }}
  # Codex reads output starting with `[` as JSON, so it is handed JSON.
  said=$( ( {hook} ) )
  [ -n "$said" ] && printf '%s\n' "$said" | awk 'BEGIN {{ ORS = ""; print "{{\"hookSpecificOutput\":{{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"" }}
    {{ gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "\\r"); if (NR > 1) print "\\n"; print }}
    END {{ print "\"}}}}\n" }}'
  ;;
working|waiting) printf %s "$1" > "$f.status" ;;
edited) : > "$f.dirty" ;;
stop)
  printf done > "$f.status"
  if [ -e "$f.dirty" ] || [ -s "$f.fix" ]; then rm -f "$f.dirty"; printf '{{}}' > "$f.turn.part" && mv "$f.turn.part" "$f.turn"; fi
  # Codex reads a stop hook's output as JSON.
  [ "$2" = json ] && printf '{{}}\n'
  ;;
esac
exit 0
"#,
        hook = crate::claude::HOOK
    )
}

/// Runs one agent, marked live in the tab while it does; the agent's own lines follow.
macro_rules! launcher {
    ($name:literal, $run:literal) => {
        concat!(
            "#!/bin/sh\n# ",
            $name,
            " with the blueprint's context (src-tauri/src/agents.rs).\n",
            real!(),
            "r=$(real ",
            $name,
            ") || { echo '",
            $name,
            ": command not found' >&2; exit 127; }\n",
            r#"trap 'rm -f "$BLUEPRINT_CONTEXT.live"' EXIT INT TERM HUP
printf "#,
            $name,
            r#" > "$BLUEPRINT_CONTEXT.live"
# A dot from the last agent in this tab would stand until the first prompt.
rm -f "$BLUEPRINT_CONTEXT.status"
export BLUEPRINT_AGENT="#,
            $name,
            "\n",
            $run,
            "\n"
        )
    };
}

const CODEX: &str = launcher!(
    "codex",
    r#"if [ -n "$BLUEPRINT_MCP_URL" ]; then
  esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
  curl -sS -m 20 -o /dev/null "$BLUEPRINT_MCP_URL/codex-trust" -H 'Content-Type: application/json' \
    -d "{\"bin\":\"$(esc "$r")\",\"home\":\"$(esc "${CODEX_HOME:-}")\"}" 2>/dev/null
fi
"$r" -c "$BLUEPRINT_CODEX_HOOKS" -c "developer_instructions=$BLUEPRINT_CODEX_SYSTEM" ${BLUEPRINT_MCP_URL:+-c "mcp_servers.blueprint-preview.url=\"$BLUEPRINT_MCP_URL\""} "$@""#
);

const OPENCODE: &str = launcher!(
    "opencode",
    r#"OPENCODE_CONFIG_CONTENT="$BLUEPRINT_OPENCODE_CONFIG" "$r" "$@""#
);

const PI: &str = launcher!(
    "pi",
    r#""$r" -e "$BLUEPRINT_BIN/blueprint-pi.cjs" --append-system-prompt "$BLUEPRINT_BIN/blueprint-agents.md" "$@""#
);

/// `codex` typed in a tab: the launcher, as `claude` is (claude.rs's CLAUDE_SHIM).
/// Not from inside an agent, nor from a script with no terminal.
#[cfg(unix)]
macro_rules! shim {
    ($name:literal) => {
        concat!(
            "#!/bin/sh\n",
            real!(),
            r#"[ -z "$BLUEPRINT_AGENT" ] && [ -t 0 ] && [ -n "$BLUEPRINT_CONTEXT" ] && exec "$BLUEPRINT_BIN/blueprint-"#,
            $name,
            r#"" "$@"
r=$(real "#,
            $name,
            r#") && exec "$r" "$@"
echo '"#,
            $name,
            r#": command not found' >&2; exit 127
"#
        )
    };
}

/// OpenCode's plugin: each prompt takes what `blueprint-hook prompt` prints, as a
/// part the model reads and the user's transcript hides; the session's events drive
/// the status dot. Only the session the user talks to, not a subagent's.
const OPENCODE_PLUGIN: &str = r#"// Blueprint's hooks for OpenCode (src-tauri/src/agents.rs).
import { execFileSync } from "node:child_process";

const hook = (...args) => {
  try {
    const sh = process.env.BLUEPRINT_BASH || "sh";
    return execFileSync(sh, [`${process.env.BLUEPRINT_BIN}/blueprint-hook`, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};
const EDITING = /^(edit|write|patch|apply_patch|multiedit|bash)$/;

export const Blueprint = async () => {
  let main = null;
  const mine = (e) => !main || !e.properties?.sessionID || e.properties.sessionID === main;
  return {
    "chat.message": async (input, output) => {
      main ??= input.sessionID;
      const said = hook("prompt").trim();
      const first = output.parts.find((p) => p.type === "text") ?? output.parts[0];
      if (said && first) output.parts.push({ ...first, id: `${first.id}b`, type: "text", text: said, synthetic: true });
    },
    "tool.execute.after": async ({ tool }) => {
      if (EDITING.test(tool)) hook("edited");
    },
    event: async ({ event }) => {
      if (!mine(event)) return;
      switch (event.type) {
        case "permission.asked":
        case "question.asked":
          return void hook("waiting");
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          return void hook("working");
        case "session.idle":
          return void hook("stop");
      }
    },
  };
};
"#;

/// Pi's extension: each prompt takes what `blueprint-hook prompt` prints, as a
/// message the model reads and the screen does not show. Pi has no MCP, so the
/// preview's tools are offered as Pi's own, each call a `tools/call` to the
/// server Claude and Codex reach; a name Pi has already (`find`) gets `preview_`.
const PI_EXTENSION: &str = r#"// Blueprint's hooks for Pi (src-tauri/src/agents.rs).
const { execFileSync } = require("node:child_process");

const hook = (...args) => {
  try {
    const sh = process.env.BLUEPRINT_BASH || "sh";
    return execFileSync(sh, [`${process.env.BLUEPRINT_BIN}/blueprint-hook`, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

const url = process.env.BLUEPRINT_MCP_URL;
let next = 1;
async function rpc(method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: next++, method, params }),
  });
  const msg = await res.json();
  if (msg.error) throw new Error(msg.error.message);
  return msg.result;
}

module.exports = function (pi) {
  let instructions = "";
  // At session start rather than load: Pi lists its own tools only once loaded.
  let bridged = false;
  pi.on("session_start", async () => {
    if (!url || bridged) return;
    bridged = true;
    try {
      instructions = (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pi", version: "1" } })).instructions ?? "";
      const taken = new Set(pi.getAllTools().map((t) => t.name));
      for (const t of (await rpc("tools/list", {})).tools) {
        const name = taken.has(t.name) ? `preview_${t.name}` : t.name;
        pi.registerTool({
          name,
          label: t.name,
          description: t.description,
          parameters: t.inputSchema,
          async execute(_id, params) {
            const r = await rpc("tools/call", { name: t.name, arguments: params ?? {} });
            const content = (r.content ?? []).map((c) => (c.type === "image" ? { type: "image", data: c.data, mimeType: c.mimeType } : { type: "text", text: c.text ?? "" }));
            if (r.isError) throw new Error(content.map((c) => c.text ?? "").join("\n"));
            return { content, details: {} };
          },
        });
      }
    } catch {
      /* the app is gone: Pi runs without the preview */
    }
  });
  pi.on("before_agent_start", async (e) => {
    const said = hook("prompt").trim();
    return {
      ...(said ? { message: { customType: "blueprint", content: said, display: false } } : {}),
      ...(instructions ? { systemPrompt: `${e.systemPrompt}\n\n${instructions}` } : {}),
    };
  });
  pi.on("tool_result", async (e) => {
    if (/^(edit|write|bash)$/.test(e.toolName)) hook("edited");
  });
  pi.on("agent_end", async () => void hook("stop"));
};
"#;

/// Codex's hooks, as the TOML `-c` takes. Their commands name no path of their
/// own, only `$BLUEPRINT_BIN`, so they hash the same in every tab and are trusted once.
fn codex_hooks() -> String {
    let h = |verb: &str| format!(r#"{{type="command",command="\"$BLUEPRINT_BIN/blueprint-hook\" {verb}"}}"#);
    format!(
        "hooks={{UserPromptSubmit=[{{hooks=[{}]}}],PermissionRequest=[{{hooks=[{}]}}],PostToolUse=[{{matcher=\"Edit|Write|Bash\",hooks=[{}]}},{{hooks=[{}]}}],Stop=[{{hooks=[{}]}}]}}",
        h("prompt json"),
        h("waiting"),
        h("edited"),
        h("working"),
        h("stop json")
    )
}

/// Writes the launchers and what they load beside claude.rs's, in `dir`.
pub fn install(dir: &Path) -> std::io::Result<()> {
    use crate::claude::install;
    install(&dir.join("blueprint-hook"), &hook_script())?;
    install(&dir.join("blueprint-agents.md"), crate::claude::AGENT_SYSTEM)?;
    install(&dir.join("blueprint-opencode.js"), OPENCODE_PLUGIN)?;
    install(&dir.join("blueprint-pi.cjs"), PI_EXTENSION)?;
    install(&dir.join("blueprint-codex"), CODEX)?;
    install(&dir.join("blueprint-opencode"), OPENCODE)?;
    install(&dir.join("blueprint-pi"), PI)?;
    #[cfg(unix)]
    {
        install(&dir.join("codex"), shim!("codex"))?;
        install(&dir.join("opencode"), shim!("opencode"))?;
        install(&dir.join("pi"), shim!("pi"))?;
    }
    #[cfg(windows)]
    for name in ["codex", "opencode", "pi"] {
        install(&dir.join(format!("blueprint-{name}.cmd")), &launcher_cmd(&format!("blueprint-{name}")))?;
    }
    Ok(())
}

/// What cmd and PowerShell find as `blueprint-<agent>` on Windows: the launcher,
/// run by Git for Windows' bash, as claude.rs's LAUNCHER_CMD runs Claude's.
#[cfg(windows)]
fn launcher_cmd(script: &str) -> String {
    format!(
        "@echo off\r\nif not defined BLUEPRINT_BASH (\r\n  echo {script} in Blueprint needs Git for Windows: https://git-scm.com/download/win 1>&2\r\n  exit /b 1\r\n)\r\n\"%BLUEPRINT_BASH%\" \"%~dp0{script}\" %*\r\n"
    )
}

/// What the launchers read from the tab's environment.
pub fn prepare(cmd: &mut CommandBuilder, dir: &Path, tab: u32) {
    cmd.env("BLUEPRINT_CODEX_HOOKS", codex_hooks());
    // A TOML string: JSON's escapes are all TOML's too.
    cmd.env("BLUEPRINT_CODEX_SYSTEM", serde_json::Value::from(crate::claude::AGENT_SYSTEM).to_string());
    let plugin = dir.join("blueprint-opencode.js");
    let mut config = serde_json::json!({
        "plugin": [format!("file://{}", plugin.to_string_lossy().replace('\\', "/"))],
        "instructions": [dir.join("blueprint-agents.md")],
    });
    if let Some(url) = crate::mcp::url(tab) {
        config["mcp"] = serde_json::json!({ "blueprint-preview": { "type": "remote", "url": url, "enabled": true } });
    }
    cmd.env("BLUEPRINT_OPENCODE_CONFIG", config.to_string());
}

/// Trusts the launcher's Codex hooks in the user's Codex config, as Codex's
/// `/hooks` would: Codex skips a hook nobody trusted. Asked by the launcher before
/// each start (mcp.rs routes it here); once a binary is done it is not asked again
/// this run of the app. The hooks are listed by the Codex that will run them, so
/// the hash recorded is the one it checks, and only what came from `-c` (ours) is
/// trusted.
pub fn trust_codex(bin: &str, home: &str) -> Result<(), String> {
    use std::io::{BufRead, Write};
    use std::sync::{Mutex, OnceLock};
    static DONE: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    let done = DONE.get_or_init(Default::default);
    let key = format!("{bin}\n{home}");
    if done.lock().unwrap().contains(&key) {
        return Ok(());
    }
    let mut cmd = crate::proc::command(bin);
    cmd.args(["app-server", "-c", &codex_hooks()]);
    if !home.is_empty() {
        cmd.env("CODEX_HOME", home);
    }
    let mut child = cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = std::sync::mpsc::channel::<serde_json::Value>();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if v.get("id").is_some() && tx.send(v).is_err() {
                    break;
                }
            }
        }
    });
    let mut send = |v: serde_json::Value| writeln!(stdin, "{v}").map_err(|e| e.to_string());
    let reply = |id: u64| -> Result<serde_json::Value, String> {
        let until = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            let left = until.saturating_duration_since(std::time::Instant::now());
            let v = rx.recv_timeout(left).map_err(|_| "Codex did not answer".to_string())?;
            if v["id"] == id {
                return v.get("result").cloned().ok_or_else(|| v["error"].to_string());
            }
        }
    };
    let out = (|| {
        send(serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "clientInfo": { "name": "blueprint", "version": env!("CARGO_PKG_VERSION") } } }))?;
        reply(1)?;
        send(serde_json::json!({ "jsonrpc": "2.0", "method": "initialized" }))?;
        let cwd = crate::proc::home().unwrap_or_default();
        send(serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "hooks/list", "params": { "cwds": [cwd] } }))?;
        let listed = reply(2)?;
        let untrusted = untrusted(&listed);
        if !untrusted.is_empty() {
            let edit = serde_json::json!({ "keyPath": "hooks.state", "mergeStrategy": "upsert", "value": untrusted });
            send(serde_json::json!({ "jsonrpc": "2.0", "id": 3, "method": "config/batchWrite", "params": { "edits": [edit] } }))?;
            reply(3)?;
        }
        Ok(())
    })();
    let _ = child.kill();
    let _ = child.wait();
    if out.is_ok() {
        done.lock().unwrap().insert(key);
    }
    out
}

/// The `hooks.state` entries that trust what `hooks/list` found from `-c` and not yet trusted.
fn untrusted(listed: &serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    listed["data"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|d| d["hooks"].as_array().into_iter().flatten())
        .filter(|h| h["source"] == "sessionFlags" && h["trustStatus"] != "trusted")
        .filter_map(|h| Some((h["key"].as_str()?.to_string(), serde_json::json!({ "trusted_hash": h["currentHash"].as_str()? }))))
        .collect()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Command;

    fn hook(q: &Path, args: &[&str]) -> String {
        let dir = q.parent().unwrap().join("bin");
        install(&dir).unwrap();
        let out = Command::new("sh").arg(dir.join("blueprint-hook")).args(args).env("BLUEPRINT_CONTEXT", q).output().unwrap();
        assert!(out.status.success());
        String::from_utf8(out.stdout).unwrap()
    }

    #[test]
    fn a_prompt_takes_the_picks_once_and_a_turn_that_edited_is_followed() {
        let dir = tempfile::tempdir().unwrap();
        let q = dir.path().join("context-1.md");
        crate::claude::place(&q, "[Reading now: repo › Sign ups]\n[Blueprint section: Sign ups\nFive stages.]").unwrap();
        crate::claude::append(&q, "[Blueprint element: a row]").unwrap();
        let said = hook(&q, &["prompt"]);
        assert!(said.starts_with("[Reading now:") && said.contains("Five stages.") && said.contains("a row"), "{said}");
        assert_eq!(crate::claude::status_of(&q).as_deref(), Some("working"));
        assert!(!hook(&q, &["prompt"]).contains("a row"));

        // A turn that only talked is not followed.
        assert_eq!(hook(&q, &["stop", "json"]), "{}\n");
        assert_eq!(crate::claude::status_of(&q).as_deref(), Some("done"));
        assert!(crate::claude::take_turn(&q).is_none());
        hook(&q, &["edited"]);
        assert_eq!(hook(&q, &["stop"]), "");
        assert!(crate::claude::take_turn(&q).is_some());
        hook(&q, &["waiting"]);
        assert_eq!(crate::claude::status_of(&q).as_deref(), Some("waiting"));

        // Codex's form: the same, as JSON it can read, quotes, tabs and lines intact.
        crate::claude::append(&q, "[Blueprint element: \"quoted\"\tand\\ more]").unwrap();
        let said: serde_json::Value = serde_json::from_str(&hook(&q, &["prompt", "json"])).unwrap();
        let ctx = said["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(ctx.starts_with("[Reading now: repo › Sign ups]\n") && ctx.contains("[Blueprint element: \"quoted\"\tand\\ more]"), "{ctx}");
        assert_eq!(hook(&q, &["prompt", "json"]).lines().count(), 1);
    }

    #[test]
    fn a_launcher_marks_the_tab_with_its_agent_and_runs_the_real_one() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let q = dir.path().join("context-1.md");
        let bin = dir.path().join("bin");
        install(&bin).unwrap();
        // A stand-in Pi, elsewhere on PATH, that says what it was handed and whether the tab is live.
        let theirs = dir.path().join("theirs");
        std::fs::create_dir_all(&theirs).unwrap();
        std::fs::write(theirs.join("pi"), format!("#!/bin/sh\ncat '{}'; printf ' %s' \"$@\"\n", crate::claude::live(&q).display())).unwrap();
        std::fs::set_permissions(theirs.join("pi"), std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = format!("{}:{}:/usr/bin:/bin", bin.display(), theirs.display());
        let out = Command::new(bin.join("blueprint-pi"))
            .arg("hello")
            .env("PATH", &path)
            .env("BLUEPRINT_BIN", &bin)
            .env("BLUEPRINT_CONTEXT", &q)
            .output()
            .unwrap();
        let said = String::from_utf8_lossy(&out.stdout);
        assert!(said.starts_with("pi -e ") && said.contains("blueprint-pi.cjs") && said.ends_with(" hello"), "{said}");
        // Gone once it exits.
        assert!(!crate::claude::running(&q));
        // `pi` from inside an agent is the real one.
        let out = Command::new(bin.join("pi")).env("PATH", &path).env("BLUEPRINT_BIN", &bin).env("BLUEPRINT_AGENT", "pi").output().unwrap();
        assert!(!String::from_utf8_lossy(&out.stdout).contains("blueprint-pi.cjs"));
    }

    #[test]
    fn only_untrusted_hooks_from_the_command_line_are_trusted() {
        let listed = serde_json::json!({ "data": [{ "hooks": [
            { "key": "/<session-flags>/config.toml:stop:0:0", "source": "sessionFlags", "trustStatus": "untrusted", "currentHash": "sha256:a" },
            { "key": "/<session-flags>/config.toml:user_prompt_submit:0:0", "source": "sessionFlags", "trustStatus": "trusted", "currentHash": "sha256:b" },
            { "key": "/repo/.codex/hooks.json:stop:0:0", "source": "project", "trustStatus": "untrusted", "currentHash": "sha256:c" }
        ] }] });
        let t = untrusted(&listed);
        assert_eq!(t.len(), 1);
        assert_eq!(t["/<session-flags>/config.toml:stop:0:0"]["trusted_hash"], "sha256:a");
    }
}
