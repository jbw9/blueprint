#!/bin/sh
# usage (from app/): npm run app:install
#   builds the checkout as it is now (uncommitted changes too) into the installed Blueprint and the
#   server it starts (src-tauri/src/server.rs), so `npm run app:dev` can rebuild and restart freely
#   beside it. The snapshot is built next to the running one and swapped in at the end, so a Blueprint
#   open while this runs keeps working until then. macOS, Linux, and Windows (Git Bash).
# BLUEPRINT_PREBUILT names an unpacked release (install.sh downloads one; .github/scripts/pack-release.sh
#   makes it): its server/ and app are placed as this would place its own build, and nothing is built.
set -e
pre=$BLUEPRINT_PREBUILT
os=$(uname)
case $os in
Darwin) data="$HOME/Library/Application Support/dev.blueprint.app" ;;
# Tauri's app_data_dir on Linux.
Linux) data="${XDG_DATA_HOME:-$HOME/.local/share}/dev.blueprint.app" ;;
# Tauri's app_data_dir on Windows: %APPDATA%.
MINGW* | MSYS* | CYGWIN*) os=Windows; data="$(cygpath -u "$APPDATA")/dev.blueprint.app" ;;
*) echo "app:install is for macOS, Linux and Windows." >&2; exit 1 ;;
esac

snap="$data/server"
next="$data/server-next"
mkdir -p "$data"
rm -rf "$next"
# Copy-on-write where the disk allows it (APFS, btrfs, XFS), a plain copy elsewhere.
clone() { if [ "$os" = Darwin ]; then cp -ca "$@"; else cp -a --reflink=auto "$@"; fi; }
if [ -n "$pre" ]; then
  mv "$pre/server" "$next"
  # A release carries .next/node_modules's links as links.json, since a junction can't be packed. They
  # point into server-next again, as a fresh build's do.
  node -e '
const fs = require("fs"), path = require("path");
const next = path.resolve(process.argv[1]), dir = path.join(next, ".next", "node_modules");
const list = path.join(dir, "links.json");
for (const [name, to] of Object.entries(JSON.parse(fs.readFileSync(list, "utf8"))))
  fs.symlinkSync(path.join(next, to), path.join(dir, name), "junction");
fs.unlinkSync(list);
' "$next"
  built=$pre
  art=$pre
else
  mkdir -p "$next"
  # The last snapshot's build caches, so next build only redoes what changed.
  if [ -d "$snap/.next/cache" ]; then mkdir -p "$next/.next" && clone "$snap/.next/cache" "$next/.next/"; fi
  for f in "$snap"/*.tsbuildinfo; do
    if [ -e "$f" ]; then clone "$f" "$next/"; fi
  done
  # The checkout, minus the Rust side and its own build output.
  for f in ./* ./.[!.]*; do
    case $f in ./src-tauri | ./.next | ./out | *.tsbuildinfo) continue ;; esac
    if [ -e "$f" ]; then clone "$f" "$next/"; fi
  done
  (cd "$next" && node node_modules/next/dist/bin/next build)
  built=src-tauri/target/release
  art=src-tauri/icons
fi
# The build links .next/node_modules to packages by absolute path (junctions on Windows can be
# nothing else), so they would point into server-next after the swap. They point into server now.
node -e '
const fs = require("fs"), path = require("path");
const [next, snap] = process.argv.slice(1).map((p) => path.resolve(p));
const dir = path.join(next, ".next", "node_modules");
if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) {
  const link = path.join(dir, name);
  if (!fs.lstatSync(link).isSymbolicLink()) continue;
  const rel = path.relative(next, path.resolve(dir, fs.readlinkSync(link)));
  if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
  fs.unlinkSync(link);
  fs.symlinkSync(path.join(snap, rel), link, "junction");
}
' "$next" "$snap"
# The Node and PATH of this shell, minus the node_modules folders npm puts first, for a Blueprint
# opened from Finder. `command -v`, not process.execPath: Homebrew's resolves to a versioned
# Cellar path that its next upgrade deletes.
# On Windows, node sees PATH in its own form (C:\..., split by ;), and Git Bash's `command -v`
# path isn't one Windows can run, so it is node's own.
node -e '
const { delimiter, sep } = require("path");
const path = process.env.PATH.split(delimiter).filter((p) => !p.includes(`${sep}node_modules${sep}`)).join(delimiter);
const node = process.platform === "win32" ? process.execPath : process.argv[2];
require("fs").writeFileSync(process.argv[1], JSON.stringify({ node, path }) + "\n");
' "$next/env.json" "$(command -v node)"

if [ -z "$pre" ]; then
  # Dictation's engine links whatever BLAS the build machine has, and distros split it differently
  # (Fedora keeps cblas_* out of libblas.so.3), so a Linux binary built on one fails to start on another.
  # Without it the engine uses its own loops, as its official Linux builds do.
  if [ "$os" = Linux ]; then
    export TRANSCRIBE_CMAKE_ARGS="${TRANSCRIBE_CMAKE_ARGS:+$TRANSCRIBE_CMAKE_ARGS }-DTRANSCRIBE_USE_SYSTEM_BLAS=OFF"
  fi
  if [ "$os" = Darwin ]; then npx tauri build --bundles app; else npx tauri build --no-bundle; fi
fi

if [ "$os" = Windows ]; then
  netstat -ano | awk '$2 ~ /:3123$/ && $4 == "LISTENING" { print $5 }' | sort -u |
    while read -r pid; do taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true; done
elif command -v lsof >/dev/null; then
  lsof -ti tcp:3123 -sTCP:LISTEN | xargs kill 2>/dev/null || true
else
  fuser -k -n tcp 3123 2>/dev/null || true
fi
# Windows frees a killed server's open files a moment after it ends, and until then its folder can't move.
retry() { for _ in 1 2 3 4 5 6 7 8 9 10; do "$@" 2>/dev/null && return; sleep 1; done; "$@"; }
rm -rf "$snap.old"
if [ -d "$snap" ]; then retry mv "$snap" "$snap.old"; fi
retry mv "$next" "$snap"
rm -rf "$snap.old"

if [ "$os" = Darwin ]; then
  # Bluprint.app is this app under its old name.
  rm -rf /Applications/Blueprint.app /Applications/Bluprint.app
  ditto "$built/bundle/macos/Blueprint.app" /Applications/Blueprint.app
  echo "Installed /Applications/Blueprint.app. Quit Blueprint if it's open, then open it again."
elif [ "$os" = Windows ]; then
  bin="$(cygpath -u "$LOCALAPPDATA")/Programs/Blueprint"
  start="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs"
  # The app under its old name; its exe stays if that copy is still running.
  rm -rf "$(cygpath -u "$LOCALAPPDATA")/Programs/Bluprint" "$start/Bluprint.lnk" "$bin/bluprint.exe" "$bin/bluprint.old.exe" 2>/dev/null || true
  mkdir -p "$bin"
  # A running exe can't be written over, but it can be moved aside.
  rm -f "$bin/blueprint.old.exe" 2>/dev/null || true
  if [ -e "$bin/blueprint.exe" ]; then mv "$bin/blueprint.exe" "$bin/blueprint.old.exe"; fi
  cp "$built/blueprint.exe" "$bin/blueprint.exe"
  rm -f "$bin/blueprint.old.exe" 2>/dev/null || true
  exe=$(cygpath -w "$bin/blueprint.exe")
  lnk=$(cygpath -w "$start/Blueprint.lnk")
  powershell -NoProfile -Command "\$s = (New-Object -ComObject WScript.Shell).CreateShortcut('$lnk'); \$s.TargetPath = '$exe'; \$s.WorkingDirectory = '$(cygpath -w "$bin")'; \$s.Save()"
  echo "Installed $exe, with Blueprint in your Start menu. Quit Blueprint if it's open, then open it again."
else
  bin="$HOME/.local/bin"
  icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/128x128/apps"
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$bin" "$icons" "$apps"
  # The app under its old name.
  rm -f "$bin/bluprint" "$icons/bluprint.png" "$apps/bluprint.desktop"
  # The command is blpr; it was blueprint before.
  rm -f "$bin/blueprint"
  # Beside the running binary, then over it: a running executable can't be written in place.
  cp "$built/blueprint" "$bin/.blpr.new"
  mv "$bin/.blpr.new" "$bin/blpr"
  cp "$art/128x128.png" "$icons/blueprint.png"
  printf '[Desktop Entry]\nType=Application\nName=Blueprint\nComment=A visual blueprint of a codebase\nExec=%s\nIcon=blueprint\nCategories=Development;\n' \
    "$bin/blpr" >"$apps/blueprint.desktop"
  echo "Installed $bin/blpr, with Blueprint in your applications menu. Quit Blueprint if it's open, then open it again."
fi
