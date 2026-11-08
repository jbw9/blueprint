#!/bin/sh
# Installs Blueprint on macOS, Linux or Windows (in Git Bash), built from source:
#   curl -fsSL https://raw.githubusercontent.com/jbw9/blueprint/main/install.sh | sh
# The source is kept in ~/.blueprint/src (BLUEPRINT_DIR moves it); running this again updates and rebuilds.
# When it ends it tells us the OS and whether it worked, nothing else; BLUEPRINT_NO_TELEMETRY=1 skips that.
set -e

# The admin dashboard's backend (app/scripts/api).
API_URL=https://kzapxbfoapvchs2sxoekvsuiey0zhbtn.lambda-url.us-east-1.on.aws

# Everything happens inside main, called on the last line, so a download cut short runs nothing.
main() {
  trap report EXIT
  # Their names while the app was called Bluprint.
  BLUEPRINT_DIR=${BLUEPRINT_DIR:-$BLUPRINT_DIR}
  BLUEPRINT_NO_TELEMETRY=${BLUEPRINT_NO_TELEMETRY:-$BLUPRINT_NO_TELEMETRY}
  repo=${BLUEPRINT_REPO:-https://github.com/jbw9/blueprint.git}
  ref=${BLUEPRINT_REF:-main}
  dir=${BLUEPRINT_DIR:-$HOME/.blueprint}/src
  # Kept in ~/.bluprint while the app had that name.
  if [ -z "$BLUEPRINT_DIR" ] && [ -d "$HOME/.bluprint" ] && [ ! -e "$HOME/.blueprint" ]; then mv "$HOME/.bluprint" "$HOME/.blueprint"; fi
  os=$(uname)
  case $os in
  Darwin | Linux) ;;
  MINGW* | MSYS* | CYGWIN*) os=Windows ;;
  *) die "Blueprint installs on macOS, Linux and Windows (in Git Bash: https://git-scm.com/downloads/win)." ;;
  esac
  # rustup's default place, for a shell opened before Rust was installed.
  [ -x "$HOME/.cargo/bin/cargo" ] && PATH="$HOME/.cargo/bin:$PATH"

  missing=""
  if [ "$os" = Darwin ]; then
    need git "xcode-select --install"
    need c++ "xcode-select --install"
    need node "Node 20 or newer: https://nodejs.org (or: brew install node)"
    need cmake "brew install cmake (or https://cmake.org/download)"
  elif [ "$os" = Windows ]; then
    need node "Node 20 or newer: winget install OpenJS.NodeJS.LTS (or https://nodejs.org)"
    need cmake "winget install Kitware.CMake (or https://cmake.org/download)"
    # Rust links with MSVC's C++ tools, which only vswhere can find from here.
    vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
    [ -n "$("$vswhere" -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null)" ] ||
      missing="$missing
  - the Visual Studio C++ build tools: winget install Microsoft.VisualStudio.2022.BuildTools --override \"--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\""
  else
    need git "your package manager's git"
    need node "Node 20 or newer: https://nodejs.org/en/download/package-manager"
    if command -v apt-get >/dev/null; then
      sys="sudo apt-get install -y build-essential cmake pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libasound2-dev libpulse-dev"
    elif command -v dnf >/dev/null; then
      sys="sudo dnf install -y gcc-c++ cmake pkgconf-pkg-config webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel alsa-lib-devel pulseaudio-libs-devel"
    elif command -v pacman >/dev/null; then
      sys="sudo pacman -S --needed base-devel cmake webkit2gtk-4.1 gtk3 librsvg openssl alsa-lib libpulse"
    else
      sys="a C++ compiler, cmake, pkg-config and the development packages of webkit2gtk-4.1, gtk3, librsvg, openssl, alsa and libpulse"
    fi
    for c in c++ cmake pkg-config; do need "$c" "$sys"; done
    if command -v pkg-config >/dev/null; then
      for m in webkit2gtk-4.1 gtk+-3.0 librsvg-2.0 openssl alsa libpulse; do
        pkg-config --exists "$m" || missing="$missing
  - the $m development files: $sys"
      done
    fi
  fi
  [ -z "$missing" ] || die "Blueprint builds from source, and needs:$missing
Install those, then run this again."
  command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] ||
    die "Blueprint needs Node 20 or newer; this is $(node -v)."
  if ! command -v cargo >/dev/null; then
    say "Installing Rust (rustup)"
    if [ "$os" = Windows ]; then
      init="$(mktemp -d)/rustup-init.exe"
      case $(uname -m) in aarch64 | arm64) arch=aarch64 ;; *) arch=x86_64 ;; esac
      curl -fsSLo "$init" "https://win.rustup.rs/$arch"
      "$init" -y --profile minimal
    else
      curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
    fi
    PATH="$HOME/.cargo/bin:$PATH"
  fi

  say "Getting the source into $dir"
  mkdir -p "$dir"
  git init -q "$dir"
  git -C "$dir" fetch -q --depth 1 "$repo" "$ref"
  git -C "$dir" checkout -q -f --detach FETCH_HEAD
  git -C "$dir" clean -qfd

  cd "$dir/app"
  say "Installing packages"
  npm ci --no-audit --no-fund
  say "Building Blueprint (the first build compiles the app: 10 to 20 minutes)"
  sh scripts/install-app.sh

  command -v claude >/dev/null ||
    say "Blueprint makes blueprints through Claude Code, which isn't on your PATH: https://claude.com/claude-code"
}

report() {
  status=$?
  ok=$([ "$status" = 0 ] && echo true || echo false)
  [ -z "$BLUEPRINT_NO_TELEMETRY" ] || return 0
  curl -fsS -m 5 -o /dev/null -X POST "$API_URL/rpc/bp_track_install" \
    -H "Content-Type: application/json" \
    -d "{\"os\":\"$(uname)\",\"arch\":\"$(uname -m)\",\"ok\":$ok}" 2>/dev/null || true
}
need() { command -v "$1" >/dev/null 2>&1 || missing="$missing
  - $1: $2"; }
say() { printf '\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '%s\n' "$1" >&2; exit 1; }

main "$@"
