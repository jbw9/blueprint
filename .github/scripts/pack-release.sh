#!/bin/sh
# Packs the Blueprint this runner just installed from source (install.sh) as the release install.sh
# downloads: server/ (the Next server as app/scripts/install.sh built it), the app, and the
# install.sh that places them. Prints the archive's path. Takes the installed server away.
set -e
src=$HOME/.blueprint/src/app
case $(uname) in
Darwin) os=darwin; data="$HOME/Library/Application Support/dev.blueprint.app" ;;
Linux) os=linux; data="${XDG_DATA_HOME:-$HOME/.local/share}/dev.blueprint.app" ;;
*) os=windows; data="$(cygpath -u "$APPDATA")/dev.blueprint.app" ;;
esac
case $(uname -m) in arm64 | aarch64) arch=arm64 ;; *) arch=x86_64 ;; esac

stage=$(mktemp -d)
server="$data/server"
# Links (junctions on Windows) don't survive the archive; install.sh makes them again from links.json.
node -e '
const fs = require("fs"), path = require("path");
const server = path.resolve(process.argv[1]), dir = path.join(server, ".next", "node_modules");
fs.mkdirSync(dir, { recursive: true });
const links = {};
for (const name of fs.readdirSync(dir)) {
  const link = path.join(dir, name);
  if (!fs.lstatSync(link).isSymbolicLink()) continue;
  links[name] = path.relative(server, path.resolve(dir, fs.readlinkSync(link)));
  fs.unlinkSync(link);
}
fs.writeFileSync(path.join(dir, "links.json"), JSON.stringify(links));
' "$server"
# The build cache only speeds up the next build here; env.json is this runner's Node and PATH.
rm -rf "$server/.next/cache" "$server/env.json"
# What the installed app compares with the next release's (app/scripts/update.mjs); a build from source has none.
printf '{"version":"%s"}\n' "${BLUEPRINT_VERSION:-0.0.0}" >"$server/release.json"
mv "$server" "$stage/server"
cp "$src/scripts/install.sh" "$stage/"
case $os in
darwin) mkdir -p "$stage/bundle/macos" && cp -R "$src/src-tauri/target/release/bundle/macos/Blueprint.app" "$stage/bundle/macos/" ;;
linux) cp "$src/src-tauri/target/release/blueprint" "$src/src-tauri/icons/128x128.png" "$stage/" ;;
windows) cp "$src/src-tauri/target/release/blueprint.exe" "$stage/" ;;
esac

out=${RUNNER_TEMP:-$(mktemp -d)}
# tar reads D:\... as a remote host.
if [ "$os" = windows ]; then out=$(cygpath -u "$out"); fi
out="$out/blueprint-$os-$arch.tar.gz"
# COPYFILE_DISABLE keeps macOS's tar from adding ._ files for extended attributes.
COPYFILE_DISABLE=1 tar -czf "$out" -C "$stage" .
rm -rf "$stage"
echo "$out"
