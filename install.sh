#!/bin/sh
set -e

API_URL=https://rn24aj5jclm6ioyeqrlsxbztky0bfwgc.lambda-url.us-east-1.on.aws
RELEASES=https://blueprint-releases-891376942131.s3.us-east-1.amazonaws.com

main() {
  trap finish EXIT
  trap 'exit 130' INT TERM
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
  file=blueprint-$(echo "$os" | tr A-Z a-z)-$arch.tar.gz
  # GitHub's copy of the release is the fallback: its anonymous downloads have gone down for hours.
  if [ -n "$BLUEPRINT_RELEASE" ]; then release=$BLUEPRINT_RELEASE mirror=
  else release=$RELEASES/latest/$file mirror=https://github.com/jbw9/blueprint/releases/latest/download/$file
  fi
  check_node
  done_line "Checked your system" "$name $arch · Node $(node -v | tr -d v)"

  case $os in
  Darwin) app=/Applications/Blueprint.app ;;
  Linux) app=$HOME/.local/bin/blueprint ;;
  Windows) app="$(cygpath -u "$LOCALAPPDATA")/Programs/Blueprint/blueprint.exe" ;;
  esac
  updating=$([ -e "$app" ] && echo 1 || true)

  tmp=$(mktemp -d)
  if [ -z "$BLUEPRINT_FROM_SOURCE" ] && find_release; then
    watch="$tmp/blueprint.tar.gz"
    note=${total:+$((total / 1048576)) MB}
    step "Downloading Blueprint" "Downloaded Blueprint" download
    watch= note=
    # Read here: steps run in a subshell, and installing moves server/ away.
    version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$tmp/server/release.json" 2>/dev/null || true)
    step "Installing Blueprint" "Installed Blueprint" install_release
    check_libs
  else
    from_source
  fi
  rm -rf "$tmp"
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
    fail "Couldn't reach GitHub to download Blueprint" "curl stopped with error $rc." \
      "Check your internet connection, then run the install command again."
  fi
  # GitHub's CDN can fail a HEAD it would serve as a GET, so a 5xx still tries the download.
  case $code in 2?? | 000 | 5??) ;; *)
    fail "GitHub couldn't hand over the Blueprint download" "It answered HTTP $code." \
      "Wait a few minutes; it's on GitHub's side, not your computer's." ;;
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

check_node() {
  if command -v brew >/dev/null; then fix="brew install node"
  elif [ "$os" = Windows ]; then fix="winget install OpenJS.NodeJS.LTS"
  elif command -v dnf >/dev/null; then fix="sudo dnf install nodejs"
  elif command -v pacman >/dev/null; then fix="sudo pacman -S nodejs npm"
  else fix="Install it from https://nodejs.org"
  fi
  command -v node >/dev/null || fail "Blueprint needs Node 20 or newer" "Node isn't installed." "$fix"
  v=$(node -p 'process.versions.node')
  [ "${v%%.*}" -ge 20 ] || fail "Blueprint needs Node 20 or newer" "You have Node $v." "$fix"
}

check_libs() {
  [ "$os" = Linux ] || return 0
  libs=$(ldd "$HOME/.local/bin/blueprint" | awk '/not found/ { print $1 }')
  [ -n "$libs" ] || return 0
  list=$(printf '%s\n' "$libs" | sed 's/^/- /')
  if command -v dnf >/dev/null; then
    fix="sudo dnf install$(printf " '%s()(64bit)'" $libs)"
  elif command -v apt-get >/dev/null && ! printf '%s\n' "$libs" | grep -qvE 'webkit|javascriptcore|gtk|gdk'; then
    fix="sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0"
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

  missing=""
  fixes=""
  if [ "$os" = Darwin ]; then
    need git "xcode-select --install"
    need c++ "xcode-select --install"
    need cmake "brew install cmake"
  elif [ "$os" = Windows ]; then
    need cmake "winget install Kitware.CMake"
    vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
    [ -n "$("$vswhere" -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>/dev/null)" ] ||
      need_ "the Visual Studio C++ build tools" "winget install Microsoft.VisualStudio.2022.BuildTools --override \"--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\""
  else
    pkgs=""
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
  [ -z "$missing" ] || fail "Building Blueprint from source needs a few things first" "$missing" "$fixes"
  done_line "Checked the build tools"

  if ! command -v cargo >/dev/null; then
    step "Installing Rust" "Installed Rust" install_rust
    PATH="$HOME/.cargo/bin:$PATH"
  fi
  step "Getting the source" "Got the source" get_source
  step "Installing packages" "Installed packages" install_packages
  step "Building Blueprint (10 to 20 minutes the first time)" "Built Blueprint" build
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
  command -v claude >/dev/null ||
    warn "Claude Code isn't installed. Blueprint makes blueprints through it" "https://claude.com/claude-code"
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
  if [ -n "$tty" ]; then
    printf '\n'
    grep -v '^ *$' "$log" | tail -n 15 | sed "s/^/    $dim/; s/\$/$off/"
    printf '\n    The full log is in %s\n' "$log"
  fi
  printf '\n    Fix what it says, then run the install command again.\n\n'
  exit 1
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
  worked=$([ "$status" = 0 ] && echo true || echo false)
  # CI is set by GitHub Actions and most other CI systems, so the dashboard can count people apart.
  ci=$([ -n "$CI" ] && echo true || echo false)
  [ -z "$BLUEPRINT_NO_TELEMETRY" ] || return 0
  curl -fsS -m 5 -o /dev/null -X POST "$API_URL/rpc/bp_track_install" \
    -H "Content-Type: application/json" \
    -d "{\"os\":\"$(uname)\",\"arch\":\"$(uname -m)\",\"ok\":$worked,\"ci\":$ci,\"version\":\"${version:-source}\"}" 2>/dev/null || true
}

main "$@"
