#!/bin/sh
# Checks an install as a visitor would have it. The app's window needs a desktop; what it opens is
# this server, started as app/src-tauri/src/server.rs does.
set -e
case $(uname) in
Darwin) test -x /Applications/Blueprint.app/Contents/MacOS/blueprint; data="$HOME/Library/Application Support/dev.blueprint.app" ;;
Linux) test -x "$HOME/.local/bin/blueprint"; test -f "$HOME/.local/share/applications/blueprint.desktop"; data="$HOME/.local/share/dev.blueprint.app" ;;
*) test -f "$(cygpath -u "$LOCALAPPDATA")/Programs/Blueprint/blueprint.exe"; data="$APPDATA/dev.blueprint.app" ;;
esac
# A Linux binary that links BLAS fails to start where the distro splits it differently (Fedora).
if [ "$(uname)" = Linux ] && ldd "$HOME/.local/bin/blueprint" | grep -i blas; then
  echo "blueprint links a system BLAS (app/scripts/install.sh turns it off)"
  exit 1
fi
node -e '
const { spawn } = require("child_process");
const dir = require("path").join(process.argv[1], "server");
const env = JSON.parse(require("fs").readFileSync(dir + "/env.json", "utf8"));
const server = spawn(env.node, [dir + "/node_modules/next/dist/bin/next", "start", "-p", "3123", "-H", "127.0.0.1"],
  { cwd: dir, env: { ...process.env, PATH: env.path }, stdio: "inherit" });
const deadline = Date.now() + 60000;
(async function poll() {
  const res = await fetch("http://127.0.0.1:3123/").catch(() => null);
  if (res) { console.log("server answered", res.status); server.kill(); process.exit(res.ok ? 0 : 1); }
  if (Date.now() > deadline) { console.log("server did not answer"); server.kill(); process.exit(1); }
  setTimeout(poll, 500);
})();
' "$data"
