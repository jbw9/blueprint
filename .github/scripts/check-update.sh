#!/bin/sh
# usage: check-update.sh <the release archive pack-release.sh made>
# Updates the Blueprint installed from that archive to the archive again, as the installed app updates
# itself: its server stages it (app/scripts/update.mjs), and its app swaps it in (src-tauri/src/update.rs).
# Then checks the install still works. What it proves is that this release's updater can update.
set -e
case $(uname) in
Darwin) os=darwin; app=/Applications/Blueprint.app/Contents/MacOS/blueprint; data="$HOME/Library/Application Support/dev.blueprint.app" ;;
Linux) os=linux; app="$HOME/.local/bin/blueprint"; data="${XDG_DATA_HOME:-$HOME/.local/share}/dev.blueprint.app" ;;
*) os=windows; app="$(cygpath -u "$LOCALAPPDATA")/Programs/Blueprint/blueprint.exe"; data="$(cygpath -u "$APPDATA")/dev.blueprint.app" ;;
esac
case $(uname -m) in arm64 | aarch64) arch=arm64 ;; *) arch=x86_64 ;; esac
pack=$1
if [ "$os" = windows ]; then pack=$(cygpath -m "$pack"); fi
work=$(mktemp -d)
if [ "$os" = windows ]; then work=$(cygpath -m "$work"); fi
sha=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$pack")
# A version above any real one, so the installed release takes it for newer.
printf '{"version":"999.0.0","assets":{"%s-%s":{"url":"%s","sha256":"%s"}}}\n' "$os" "$arch" "$pack" "$sha" >"$work/latest.json"
node "$data/server/scripts/update.mjs" "$work/latest.json"
test -f "$data/update/server/release.json"
before=$(ls -l "$app")
"$app" --apply-update
test ! -e "$data/update"
test -f "$data/server/env.json"
echo "app before: $before"
echo "app after:  $(ls -l "$app")"
sh "$(dirname "$0")/check-install.sh"
