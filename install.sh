#!/bin/sh
set -e

API_URL=https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws
RELEASES=https://blueprint-releases-891376942131.s3.us-east-1.amazonaws.com

main() {
  trap finish EXIT
  trap 'reason=interrupted; exit 130' INT TERM HUP
  began=$(date +%s) at=system reason= fixed=
  BLUEPRINT_DIR=${BLUEPRINT_DIR:-$BLUPRINT_DIR}
  BLUEPRINT_NO_TELEMETRY=${BLUEPRINT_NO_TELEMETRY:-$BLUPRINT_NO_TELEMETRY}
  repo=${BLUEPRINT_REPO:-https://github.com/jbw9/blueprint.git}
  ref=${BLUEPRINT_REF:-main}
  home=${BLUEPRINT_DIR:-$HOME/.blueprint}
  dir=$home/src
  if [ -z "$BLUEPRINT_DIR" ] && [ -d "$HOME/.bluprint" ] && [ ! -e "$HOME/.blueprint" ]; then mv "$HOME/.bluprint" "$HOME/.blueprint"; fi
  mkdir -p "$home"
  log=$home/install.log
  : >"$log"
  ui

  printf '\n  %sBlueprint installer%s\n\n' "$bold" "$off"

  os=$(uname)
  case $os in
  Darwin) name="macOS $(sw_vers -productVersion 2>/dev/null)" ;;
  Linux) name=$(. /etc/os-release 2>/dev/null && echo "$NAME${VERSION_ID:+ $VERSION_ID}") && [ -n "$name" ] || name=Linux ;;
  MINGW* | MSYS* | CYGWIN*) os=Windows name=Windows ;;
  *) fail "Blueprint doesn't install on $os" "It installs on macOS, Linux and Windows." \
    "On Windows, run the install command in Git Bash: https://git-scm.com/downloads/win" ;;
  esac
  case $(uname -m) in arm64 | aarch64) arch=arm64 ;; *) arch=x86_64 ;; esac
  case $os in
  Darwin) data="$HOME/Library/Application Support/dev.blueprint.app" ;;
  Linux) data="${XDG_DATA_HOME:-$HOME/.local/share}/dev.blueprint.app" ;;
  Windows) data="$(cygpath -u "$APPDATA")/dev.blueprint.app" ;;
  esac
  # The app's own id when it has one, so this install and the app it opens are followed as one.
  id=$(sed -n 's/.*"installId":"\([^"]*\)".*/\1/p' "$data/telemetry.json" 2>/dev/null || true)
  [ -n "$id" ] || id=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | sed 's/^\(.\{8\}\)\(.\{4\}\)\(.\{4\}\)\(.\{4\}\)/\1-\2-\3-\4-/')
  ! grep -q '"off":true' "$data/telemetry.json" 2>/dev/null || BLUEPRINT_NO_TELEMETRY=1
  report start &
  file=blueprint-$(echo "$os" | tr A-Z a-z)-$arch.tar.gz
  # GitHub's copy of the release is the fallback: its anonymous downloads have gone down for hours.
  if [ -n "$BLUEPRINT_RELEASE" ]; then release=$BLUEPRINT_RELEASE mirror=
  else release=$RELEASES/latest/$file mirror=https://github.com/jbw9/blueprint/releases/latest/download/$file
  fi
  tmp=$(mktemp -d)
  at=release
  source=
  if [ -n "$BLUEPRINT_FROM_SOURCE" ] || ! find_release; then source=1; fi
  at=check
  survey
  done_line "Checked your system" "$name $arch"
  [ -z "$wants" ] || agree
  xcode_tools
  ensure_node

  case $os in
  Darwin) app=/Applications/Blueprint.app ;;
  Linux) app=$HOME/.local/bin/blueprint ;;
  Windows) app="$(cygpath -u "$LOCALAPPDATA")/Programs/Blueprint/blueprint.exe" ;;
  esac
  updating=$([ -e "$app" ] && echo 1 || true)

  if [ -z "$source" ]; then
    watch="$tmp/blueprint.tar.gz"
    note=${total:+$((total / 1048576)) MB}
    at=download
    step "Downloading Blueprint" "Downloaded Blueprint" download
    watch= note=
    # Read here: steps run in a subshell, and installing moves server/ away.
    version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$tmp/server/release.json" 2>/dev/null || true)
    at=install
    step "Installing Blueprint" "Installed Blueprint" install_release
    at=libs
    check_libs
  else
    from_source
  fi
  [ -e "$data/telemetry.json" ] || { mkdir -p "$data" && printf '{"installId":"%s"}\n' "$id" >"$data/telemetry.json"; }
  at=claude
  ensure_claude
  rm -rf "$tmp"
  at=done
  summary
}

find_release() {
  total=
  for url in "$release" $mirror; do
    release=$url
    for try in 1 2 3 4; do
      rc=0
      # HTTP/1.1: over HTTP/2 some curls (8.7 on macOS) end a 404 with error 56.
      hdr=$(curl -sSLI --http1.1 -w 'status %{http_code}\n' "$release" 2>/dev/null) || rc=$?
      code=$(printf '%s\n' "$hdr" | awk '$1 == "status" { c = $2 } END { print c }')
      if [ "$rc" = 0 ] && [ "$code" = 404 ]; then
        warn "There's no ready-made Blueprint for $name $arch yet, so it's built from source"
        return 1
      fi
      # 000 is a file:// release, which has no status.
      case $rc:$code in 0:2?? | 0:000) break ;; esac
      [ "$try" = 4 ] || sleep $((try * 2))
    done
    case $rc:$code in 0:2?? | 0:000) break ;; esac
  done
  if [ "$rc" != 0 ]; then
    fail "Couldn't reach the server to download Blueprint" "curl stopped with error $rc." \
      "Check your internet connection, then run the install command again."
  fi
  # GitHub's CDN can fail a HEAD it would serve as a GET, so a 5xx still tries the download.
  case $code in 2?? | 000 | 5??) ;; *)
    fail "The server couldn't hand over the Blueprint download" "It answered HTTP $code." \
      "Wait a few minutes; it's on the server's side, not your computer's." ;;
  esac
  total=$(printf '%s\n' "$hdr" | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n }')
}

download() {
  curl -fsSL "$release" -o "$tmp/blueprint.tar.gz"
  tar -xzf "$tmp/blueprint.tar.gz" -C "$tmp"
  rm "$tmp/blueprint.tar.gz"
}

install_release() {
  place="$tmp/install.sh"
  [ -e "$place" ] || place="$tmp/install-app.sh"
  BLUEPRINT_PREBUILT="$tmp" sh "$place"
}

# Everything missing, found before anything is installed, so they're asked once.
survey() {
  wants=
  if [ "$os" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then
    xcode="Apple's command line tools (asks for your password), for git, which Blueprint uses to:
  read your repository's files and history when it makes a blueprint
  clone a repository when you paste a link"
    [ -z "$source" ] || xcode="$xcode
  and for the C++ compiler, which builds Blueprint"
    want "$xcode" "xcode-select --install"
  fi
  if command -v brew >/dev/null; then nodefix="brew install node@22"
  elif [ "$os" = Windows ]; then nodefix="winget install OpenJS.NodeJS.LTS"
  else nodefix="Install Node 22 from https://nodejs.org"
  fi
  needs_node && want "Node 22, just for Blueprint, in ~/.blueprint (your own Node isn't touched), which runs:
  the app itself
  the generator that makes your blueprints" "$nodefix"
  if [ -n "$source" ]; then
    check_tools
    [ -z "$missing" ] || want "What building Blueprint needs:
$(printf '%s\n' "$missing" | sed 's/^/  /')" "$fixes"
    command -v cargo >/dev/null || [ -x "$HOME/.cargo/bin/cargo" ] || want "Rust, to build Blueprint" "curl https://sh.rustup.rs -sSf | sh"
  elif [ "$os" = Linux ]; then
    l=
    command -v git >/dev/null || l="$l git"
    ldconfig -p 2>/dev/null | grep -q libwebkit2gtk-4.1 || l="$l WebKitGTK"
    ldconfig -p 2>/dev/null | grep -q libgtk-3 || l="$l GTK"
    if command -v apt-get >/dev/null; then libfix="sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0 git"
    elif command -v dnf >/dev/null; then libfix="sudo dnf install webkit2gtk4.1 gtk3 git"
    elif command -v pacman >/dev/null; then libfix="sudo pacman -S webkit2gtk-4.1 gtk3 git"
    else libfix="Install WebKitGTK 4.1, GTK 3 and git with your package manager."
    fi
    [ -z "$l" ] || want "System libraries Blueprint opens with:$l (asks for your password)" "$libfix"
  fi
  has_claude || want "Claude Code, which Blueprint uses to:
  write your blueprints
  run the Claude tabs beside them" "curl -fsSL https://claude.ai/install.sh | bash"
}

want() {
  wants="${wants:+$wants
}$1"
  todo="${todo:+$todo
}$2"
}

# Yes unless they say no. Without a terminal to ask (CI, a script) it goes ahead; BLUEPRINT_YES=1 skips asking.
agree() {
  printf '\n  Blueprint needs a few things this computer doesn'"'"'t have:\n\n'
  printf '%s\n' "$wants" | sed "s/^  /        · /; s/^\([^ ]\)/    - \1/"
  [ -z "$BLUEPRINT_YES" ] && (: </dev/tty) 2>/dev/null || { printf '\n'; return 0; }
  printf '\n  Install them? %s[Y/n]%s ' "$bold" "$off"
  read -r answer </dev/tty || answer=
  printf '\n'
  case $answer in [nN]*)
    declined=1
    fail "Blueprint didn't install anything" "" "$todo"
    ;;
  esac
}

needs_node() {
  v=$(node -p 'process.versions.node' 2>/dev/null || true)
  [ -n "$BLUEPRINT_PRIVATE_NODE" ] || [ -z "$v" ] || [ "${v%%.*}" -lt 22 ] || return 1
  v=$("$(node_bin)/node" -p 'process.versions.node' 2>/dev/null || true)
  [ -z "$v" ] || [ "${v%%.*}" -lt 22 ]
}

node_bin() { if [ "$os" = Windows ]; then echo "$home/node"; else echo "$home/node/bin"; fi; }

has_claude() {
  for c in "$(command -v claude 2>/dev/null)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" "$HOME/.local/bin/claude.exe"; do
    [ -n "$c" ] && [ -x "$c" ] && return 0
  done
  return 1
}

# Blueprint's own Node, in $home/node, when the computer's is missing or older than 22 (the
# generator uses Promise.withResolvers). The computer's Node is left as it is.
ensure_node() {
  at=node
  v=$(node -p 'process.versions.node' 2>/dev/null || true)
  [ -n "$BLUEPRINT_PRIVATE_NODE" ] || [ -z "$v" ] || [ "${v%%.*}" -lt 22 ] || return 0
  if needs_node; then
    [ -z "$declined" ] || fail "Blueprint needs Node 22 or newer" "${v:+You have Node $v.}" "Install it from https://nodejs.org"
    try_step "Installing Node 22 for Blueprint" "Installed Node 22 for Blueprint" install_node ||
      fail "Blueprint needs Node 22 or newer, and couldn't install it" "" "Install it from https://nodejs.org"
    fixed="$fixed node"
  fi
  PATH="$(node_bin):$PATH"
}

install_node() {
  case $os in Darwin) p=darwin ext=tar.gz ;; Linux) p=linux ext=tar.gz ;; Windows) p=win ext=zip ;; esac
  case $arch in arm64) p=$p-arm64 ;; *) p=$p-x64 ;; esac
  base=https://nodejs.org/dist/latest-v22.x
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/node.sums"
  pkg=$(awk -v s="-$p.$ext" '{ if (substr($2, length($2) - length(s) + 1) == s) print $2 }' "$tmp/node.sums")
  [ -n "$pkg" ] || { echo "nodejs.org has no Node 22 for $p" >&2; exit 1; }
  curl -fsSL "$base/$pkg" -o "$tmp/$pkg"
  want=$(awk -v f="$pkg" '$2 == f { print $1 }' "$tmp/node.sums")
  got=$( (sha256sum "$tmp/$pkg" 2>/dev/null || shasum -a 256 "$tmp/$pkg") | awk '{ print $1 }')
  [ "$got" = "$want" ] || { echo "The Node download didn't match its checksum" >&2; exit 1; }
  rm -rf "$tmp/node" "$home/node"
  mkdir -p "$tmp/node"
  if [ "$ext" = tar.gz ]; then tar -xzf "$tmp/$pkg" -C "$tmp/node"
  elif command -v unzip >/dev/null; then unzip -q "$tmp/$pkg" -d "$tmp/node"
  else powershell -NoProfile -Command "Expand-Archive -LiteralPath '$(cygpath -w "$tmp/$pkg")' -DestinationPath '$(cygpath -w "$tmp/node")'"
  fi
  mv "$tmp/node/${pkg%.$ext}" "$home/node"
}

# git, and the compiler a build from source needs: from Apple's software update in the terminal, as
# Homebrew gets them, or from Apple's own window when software update doesn't list them.
xcode_tools() {
  [ "$os" = Darwin ] || return 0
  xcode-select -p >/dev/null 2>&1 && return 0
  at=xcode-tools
  [ -z "$declined" ] || fail "Blueprint needs Apple's command line tools, which have git" "" "xcode-select --install"
  if ! { can_root && try_step "Installing Apple's command line tools (a few minutes)" "Installed Apple's command line tools" install_xcode; }; then
    xcode-select --install >/dev/null 2>&1 || true
    warn "A window asks to install Apple's command line tools: click Install" "This goes on once they're in."
    try_step "Waiting for Apple's command line tools" "Installed Apple's command line tools" wait_xcode ||
      fail "Apple's command line tools aren't installed" "" "xcode-select --install"
  fi
  fixed="$fixed xcode-tools"
}

install_xcode() {
  # This file makes software update list the command line tools.
  flag=/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  touch "$flag"
  label=$(softwareupdate -l 2>/dev/null | sed -n 's/^[* ]*Label: \(Command Line Tools.*\)$/\1/p' | tail -n 1)
  [ -n "$label" ] || { rm -f "$flag"; echo "Software update doesn't list Apple's command line tools" >&2; exit 1; }
  sudo -n softwareupdate -i "$label"
  rm -f "$flag"
  xcode-select -p >/dev/null 2>&1
}

wait_xcode() {
  i=0
  until xcode-select -p >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -lt 360 ] || { echo "They weren't installed within 30 minutes" >&2; exit 1; }
    sleep 5
  done
}

ensure_claude() {
  has_claude && return 0
  if [ -n "$declined" ]; then
    warn "Claude Code isn't installed. Blueprint makes blueprints with it" "https://claude.com/claude-code"
  elif try_step "Installing Claude Code" "Installed Claude Code" install_claude; then
    fixed="$fixed claude"
  else
    reason="claude didn't install"
    warn "Claude Code didn't install. Blueprint makes blueprints through it" "https://claude.com/claude-code"
  fi
}

install_claude() {
  if [ "$os" = Windows ]; then
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
  else
    curl -fsSL https://claude.ai/install.sh | bash
  fi
}

# Runs as root: itself when it is root, or through sudo, asking for the password once, in the open.
can_root() {
  [ "$(id -u)" = 0 ] && return 0
  command -v sudo >/dev/null || return 1
  sudo -n true 2>/dev/null && return 0
  (: </dev/tty) 2>/dev/null || return 1
  printf '    Installing them needs your password.\n'
  sudo -v -p '    Password: ' </dev/tty
}

root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi; }

linux_install() {
  if command -v apt-get >/dev/null; then
    root apt-get update -q
    root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  elif command -v dnf >/dev/null; then root dnf install -y "$@"
  elif command -v pacman >/dev/null; then root pacman -S --needed --noconfirm "$@"
  else exit 1
  fi
}

# The libraries the app opens with (and git, which it runs) that a ready-made Blueprint on Linux needs.
missing_libs() {
  libs=$(ldd "$HOME/.local/bin/blueprint" | awk '/not found/ { print $1 }')
  command -v git >/dev/null || libs="$libs git"
}

check_libs() {
  [ "$os" = Linux ] || return 0
  missing_libs
  [ -n "$(echo $libs)" ] || return 0
  if command -v dnf >/dev/null; then
    pkgs=$(for l in $libs; do [ "$l" = git ] && echo git || printf "%s()(64bit)\n" "$l"; done)
  elif command -v apt-get >/dev/null; then pkgs="libwebkit2gtk-4.1-0 libgtk-3-0 git"
  elif command -v pacman >/dev/null; then pkgs="webkit2gtk-4.1 gtk3 git"
  fi
  if [ -z "$declined" ] && [ -n "$pkgs" ] && can_root && try_step "Installing the system libraries Blueprint needs" "Installed the system libraries" linux_install $pkgs; then
    missing_libs
    fixed="$fixed libs"
  fi
  [ -n "$(echo $libs)" ] || return 0
  list=$(printf '%s\n' $libs | sed 's/^/- /')
  if command -v dnf >/dev/null; then
    fix="sudo dnf install$(printf " '%s()(64bit)'" $libs)"
  elif command -v apt-get >/dev/null && ! printf '%s\n' $libs | grep -qvE 'webkit|javascriptcore|gtk|gdk|git'; then
    fix="sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0 git"
  elif command -v pacman >/dev/null; then
    fix="Find the package that has each one with: pacman -F <library>"
  else
    fix="Install the packages that provide them with your package manager."
  fi
  fail "Blueprint is installed, but needs system libraries this computer doesn't have" "$list" "$fix" \
    "Then open Blueprint; there's no need to run the install again."
}

from_source() {
  [ -x "$HOME/.cargo/bin/cargo" ] && PATH="$HOME/.cargo/bin:$PATH"

  at=tools
  check_tools
  if [ -n "$missing" ] && [ -z "$declined" ] && get_tools; then
    check_tools
    fixed="$fixed build-tools"
  fi
  [ -z "$missing" ] || fail "Building Blueprint from source needs a few things first" "$missing" "$fixes"
  done_line "Checked the build tools"

  if ! command -v cargo >/dev/null; then
    at=rust
    [ -z "$declined" ] || fail "Building Blueprint needs Rust" "" "curl https://sh.rustup.rs -sSf | sh"
    step "Installing Rust" "Installed Rust" install_rust
    PATH="$HOME/.cargo/bin:$PATH"
    fixed="$fixed rust"
  fi
  at=source
  step "Getting the source" "Got the source" get_source
  at=packages
  step "Installing packages" "Installed packages" install_packages
  at=build
  step "Building Blueprint (10 to 20 minutes the first time)" "Built Blueprint" build
}

check_tools() {
  missing="" fixes="" pkgs=""
  if [ "$os" = Darwin ]; then
    need git "xcode-select --install"
    need c++ "xcode-select --install"
    need cmake "brew install cmake"
  elif [ "$os" = Windows ]; then
    need cmake "winget install Kitware.CMake"
    has_vc ||
      need_ "the Visual Studio C++ build tools" "winget install Microsoft.VisualStudio.2022.BuildTools --override \"--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\""
  else
    for row in \
      "git git git git" \
      "c++ build-essential gcc-c++ base-devel" \
      "cmake cmake cmake cmake" \
      "pkg-config pkg-config pkgconf-pkg-config pkgconf" \
      "webkit2gtk-4.1 libwebkit2gtk-4.1-dev webkit2gtk4.1-devel webkit2gtk-4.1" \
      "gtk+-3.0 libgtk-3-dev gtk3-devel gtk3" \
      "librsvg-2.0 librsvg2-dev librsvg2-devel librsvg" \
      "openssl libssl-dev openssl-devel openssl" \
      "alsa libasound2-dev alsa-lib-devel alsa-lib" \
      "libpulse libpulse-dev pulseaudio-libs-devel libpulse"; do
      set -- $row
      case $1 in
      git | c++ | cmake | pkg-config) command -v "$1" >/dev/null && continue; what=$1 ;;
      *) command -v pkg-config >/dev/null && pkg-config --exists "$1" && continue; what="$1 (development files)" ;;
      esac
      missing="${missing:+$missing
}- $what"
      if command -v apt-get >/dev/null; then pkgs="$pkgs $2"
      elif command -v dnf >/dev/null; then pkgs="$pkgs $3"
      elif command -v pacman >/dev/null; then pkgs="$pkgs $4"
      fi
    done
    if [ -z "$pkgs" ]; then fixes="Install them with your package manager."
    elif command -v apt-get >/dev/null; then fixes="sudo apt-get install -y$pkgs"
    elif command -v dnf >/dev/null; then fixes="sudo dnf install -y$pkgs"
    else fixes="sudo pacman -S --needed$pkgs"
    fi
  fi
}

has_vc() {
  vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
  [ -n "$("$vswhere" -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null)" ]
}

# What check_tools found missing, installed with the system's own package manager.
get_tools() {
  case $os in
  Linux) [ -n "$pkgs" ] && can_root && try_step "Installing what the build needs" "Installed what the build needs" linux_install $pkgs ;;
  Darwin) command -v brew >/dev/null && try_step "Installing CMake" "Installed CMake" brew install cmake ;;
  Windows)
    command -v winget >/dev/null && try_step "Installing the build tools" "Installed the build tools" windows_tools || return 1
    PATH="/c/Program Files/CMake/bin:$PATH"
    ;;
  esac
}

windows_tools() {
  agree="--silent --accept-package-agreements --accept-source-agreements"
  command -v cmake >/dev/null || winget install -e --id Kitware.CMake $agree
  has_vc || winget install -e --id Microsoft.VisualStudio.2022.BuildTools $agree \
    --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

install_rust() {
  if [ "$os" = Windows ]; then
    case $(uname -m) in aarch64 | arm64) a=aarch64 ;; *) a=x86_64 ;; esac
    init="$(mktemp -d)/rustup-init.exe"
    curl -fsSLo "$init" "https://win.rustup.rs/$a"
    "$init" -y --profile minimal
  else
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  fi
}

get_source() {
  mkdir -p "$dir"
  git init -q "$dir"
  git -C "$dir" fetch -q --depth 1 "$repo" "$ref"
  git -C "$dir" checkout -q -f --detach FETCH_HEAD
  git -C "$dir" clean -qfd
}

install_packages() {
  cd "$dir/app"
  npm ci --no-audit --no-fund
}

build() {
  cd "$dir/app"
  sh scripts/install.sh
}

summary() {
  printf '\n'
  if [ -n "$updating" ]; then
    printf '  %sBlueprint is updated.%s Quit it if it'"'"'s open, then open it again.\n\n' "$green$bold" "$off"
  else
    printf '  %sBlueprint is installed.%s\n\n' "$green$bold" "$off"
  fi
  case $os in
  Darwin) printf '  Open it from Applications, or run: %sopen -a Blueprint%s\n\n' "$cyan" "$off" ;;
  Windows) printf '  Open it from the Start menu.\n\n' ;;
  Linux)
    run=blueprint
    case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) run="~/.local/bin/blueprint" ;; esac
    printf '  Open it from your applications menu, or run: %s%s%s\n\n' "$cyan" "$run" "$off"
    ;;
  esac
}

ui() {
  tty=
  bold='' dim='' red='' green='' yellow='' cyan='' off=''
  if [ -t 1 ] && [ "$TERM" != dumb ]; then
    tty=1
    if [ -z "$NO_COLOR" ]; then
      e=$(printf '\033')
      bold="$e[1m" dim="$e[2m" red="$e[31m" green="$e[32m" yellow="$e[33m" cyan="$e[36m" off="$e[0m"
    fi
  fi
  case "${LC_ALL:-${LC_CTYPE:-$LANG}}" in
  *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) ok="✓" bad="✗" frames="⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏" ;;
  *) ok="+" bad="x" frames='| / - \' ;;
  esac
  spid= note=
}

step() {
  doing=$1 did=$2
  shift 2
  start=$(date +%s)
  printf '\n$ %s\n' "$*" >>"$log"
  if [ -z "$tty" ]; then
    printf '==> %s\n' "$doing"
    set +e
    (set -e; "$@") </dev/null
    rc=$?
    set -e
  else
    spin "$doing" &
    spid=$!
    set +e
    (set -e; "$@") </dev/null >>"$log" 2>&1
    rc=$?
    set -e
    unspin
  fi
  if [ "$rc" = 0 ]; then
    done_line "$did" "${note:+$note · }$(since "$start")"
    return
  fi
  printf '  %s%s %s%s\n' "$red$bold" "$bad" "$doing" "$off"
  # The log's last line says why, with the home folder's path taken out.
  reason="exit $rc"
  if [ -n "$tty" ]; then
    reason=$(grep -v '^ *$' "$log" | tail -n 1 | sed "s|$HOME|~|g" | cut -c 1-120)
    printf '\n'
    grep -v '^ *$' "$log" | tail -n 15 | sed "s/^/    $dim/; s/\$/$off/"
    printf '\n    The full log is in %s\n' "$log"
  fi
  [ -z "$soft" ] || { printf '\n'; return 1; }
  printf '\n    Fix what it says, then run the install command again.\n\n'
  exit 1
}

# A step whose failure is handled by the caller instead of ending the install.
try_step() {
  soft=1
  step "$@" && r=0 || r=$?
  soft=
  return $r
}

spin() {
  trap - EXIT INT TERM
  printf '\033[?25l'
  while :; do
    for f in $frames; do
      t=$(since "$start")
      extra=
      if [ -n "$watch" ] && [ -f "$watch" ]; then
        got=$(($(wc -c <"$watch") / 1048576))
        extra="$got MB"
        [ -z "$total" ] || extra="$got / $((total / 1048576)) MB"
      fi
      printf '\r\033[K  %s%s%s %s  %s%s%s' "$cyan" "$f" "$off" "$1" "$dim" "${extra:+$extra · }$t" "$off"
      sleep 0.1
    done
  done
}

unspin() {
  [ -n "$spid" ] || return 0
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  spid=
  printf '\r\033[K\033[?25h'
}

since() {
  s=$(($(date +%s) - $1))
  if [ "$s" -lt 60 ]; then echo "${s}s"; else printf '%dm %02ds\n' $((s / 60)) $((s % 60)); fi
}

done_line() {
  if [ -n "$2" ]; then
    printf '  %s%s%s %-28s %s%s%s\n' "$green" "$ok" "$off" "$1" "$dim" "$2" "$off"
  else
    printf '  %s%s%s %s\n' "$green" "$ok" "$off" "$1"
  fi
}

warn() {
  printf '  %s! %s%s\n' "$yellow" "$1" "$off"
  [ -z "$2" ] || printf '    %s\n' "$2"
}

fail() {
  unspin
  reason=${declined:+declined: }$1
  printf '\n  %s%s %s%s\n' "$red$bold" "$bad" "$1" "$off"
  [ -z "$2" ] || printf '%s\n' "$2" | sed 's/^/    /'
  if [ -n "$3" ]; then
    printf '\n'
    first=1
    printf '%s\n' "$3" | while IFS= read -r line; do
      if [ -n "$first" ]; then printf '    Fix:  %s%s%s\n' "$cyan" "$line" "$off"; first=
      else printf '          %s%s%s\n' "$cyan" "$line" "$off"; fi
    done
  fi
  printf '    %s\n\n' "${4:-Then run the install command again.}"
  exit 1
}

need() { command -v "$1" >/dev/null 2>&1 || need_ "$1" "$2"; }
need_() {
  missing="${missing:+$missing
}- $1"
  case "
$fixes
" in *"
$2
"*) ;; *) fixes="${fixes:+$fixes
}$2" ;; esac
}

finish() {
  status=$?
  unspin
  [ -n "$tty" ] && printf '\033[?25h'
  [ -z "$tmp" ] || rm -rf "$tmp"
  report end
}

# What the dashboard (blpr.dev/admin) learns of this install: never a path, file or name of yours.
report() {
  [ -z "$BLUEPRINT_NO_TELEMETRY" ] || return 0
  worked=$([ "$1" = end ] && [ "$status" = 0 ] && echo true || echo false)
  # CI is set by GitHub Actions and most other CI systems, so the dashboard can count people apart.
  ci=$([ -n "$CI" ] && echo true || echo false)
  list=$(for f in $fixed; do printf ',"%s"' "$f"; done)
  why=$(printf '%s' "$reason" | tr -d '"\\' | tr '\t\r\n' '   ')
  curl -fsS -m 5 -o /dev/null -X POST "$API_URL/rpc/bp_track_install" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$id\",\"phase\":\"$1\",\"os\":\"$(uname)\",\"arch\":\"$(uname -m)\",\"ok\":$worked,\"ci\":$ci,\"version\":\"${version:-source}\",\"step\":\"$at\",\"reason\":\"$why\",\"seconds\":$(($(date +%s) - ${began:-$(date +%s)})),\"fixed\":[${list#,}],\"node\":\"$(node -v 2>/dev/null | tr -d v)\"}" 2>/dev/null || true
}

main "$@"
