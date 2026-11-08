#!/bin/sh
# Installs Blueprint on macOS, Linux or Windows (in Git Bash):
#   curl -fsSL https://blpr.dev/install.sh | sh
# blpr.dev serves this file as main has it (scripts/build-site.sh).
# It downloads the build of main that CI publishes for this system (.github/workflows/install.yml), and
# builds from source where there is none, or with BLUEPRINT_FROM_SOURCE=1. Running this again updates.
# A build from source is kept in ~/.blueprint/src (BLUEPRINT_DIR moves it).
# When it ends it tells us the OS and whether it worked, nothing else; BLUEPRINT_NO_TELEMETRY=1 skips that.
set -e

# The admin dashboard's backend (app/scripts/api).
API_URL=https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws

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
  case $(uname -m) in arm64 | aarch64) arch=arm64 ;; *) arch=x86_64 ;; esac
  release=${BLUEPRINT_RELEASE:-https://github.com/jbw9/blueprint/releases/download/latest/blueprint-$(echo "$os" | tr A-Z a-z)-$arch.tar.gz}
  # Blueprint's server runs on Node, however it's installed.
  command -v node >/dev/null || die "Blueprint needs Node 20 or newer: https://nodejs.org"
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Blueprint needs Node 20 or newer; this is $(node -v)."

  tmp=$(mktemp -d)
  if [ -z "$BLUEPRINT_FROM_SOURCE" ] && download; then
    say "Installing Blueprint"
    # Releases packed before app/scripts/install.sh was renamed carry it as install-app.sh.
    place="$tmp/install.sh"
    [ -e "$place" ] || place="$tmp/install-app.sh"
    BLUEPRINT_PREBUILT="$tmp" sh "$place"
    # The release is built against the system libraries a source build would install.
    if [ "$os" = Linux ] && libs=$(ldd "$HOME/.local/bin/blueprint" | grep "not found"); then
      die "Blueprint needs system libraries this computer doesn't have:
$libs
Install webkit2gtk 4.1 and gtk3 (Debian or Ubuntu: sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0), then open it."
    fi
  else
    from_source
  fi
  rm -rf "$tmp"

  command -v claude >/dev/null ||
    say "Blueprint makes blueprints through Claude Code, which isn't on your PATH: https://claude.com/claude-code"
}

# The release, unpacked into $tmp. Fails, building from source instead, when there's none for this system.
download() {
  say "Downloading Blueprint"
  curl -fL --progress-bar "$release" -o "$tmp/blueprint.tar.gz" && tar -xzf "$tmp/blueprint.tar.gz" -C "$tmp" && rm "$tmp/blueprint.tar.gz" ||
    { say "There's no ready-made Blueprint for this system, so it's built from source"; return 1; }
}

from_source() {
  # rustup's default place, for a shell opened before Rust was installed.
  [ -x "$HOME/.cargo/bin/cargo" ] && PATH="$HOME/.cargo/bin:$PATH"

  missing=""
  if [ "$os" = Darwin ]; then
    need git "xcode-select --install"
    need c++ "xcode-select --install"
    need cmake "brew install cmake (or https://cmake.org/download)"
  elif [ "$os" = Windows ]; then
    need cmake "winget install Kitware.CMake (or https://cmake.org/download)"
    # Rust links with MSVC's C++ tools, which only vswhere can find from here.
    vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
    [ -n "$("$vswhere" -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null)" ] ||
      missing="$missing
  - the Visual Studio C++ build tools: winget install Microsoft.VisualStudio.2022.BuildTools --override \"--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\""
  else
    need git "your package manager's git"
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
  sh scripts/install.sh
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
