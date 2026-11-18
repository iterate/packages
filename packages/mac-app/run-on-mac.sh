#!/bin/sh
# Builds the app on a Mac, installs it as /Applications/iterate.app and opens it. Run it again to
# update: it quits the running copy, puts the new build in its place and opens it again. The app
# then starts by itself at each login (it registers itself as a login item; System Settings ›
# General › Login Items shows it and can turn it off).
#
#   ./run-on-mac.sh               build, sign, install in /Applications, open (also: update)
#   ./run-on-mac.sh --install     build, sign, install; open nothing, follow no log (cli.mjs runs this)
#   ./run-on-mac.sh --build-only  build and sign .build/iterate.app; install and open nothing
#
# ITERATE_MAC_APP_INSTALL names another place to install; ITERATE_MAC_APP_VERSION is written into
# the bundle as its version.
#   ./run-on-mac.sh --quit        quit the app; build and open nothing
#   ./run-on-mac.sh --logs        follow app.log; build and open nothing
#   ./run-on-mac.sh --logs system follow system.log
#
# The bundle is needed: without an Info.plist the system has no microphone usage text, and it
# attributes the privacy prompts to the terminal instead of to this app.
#
# The signature is local: a self-signed certificate that this script makes once, in a keychain of
# its own (no Apple account). macOS ties a permission to the signature, so with one certificate the
# microphone permission stays through every rebuild. An ad hoc signature (`codesign --sign -`)
# changes with each build, and macOS then asks again each time. VOICE_MEET_SIGN=adhoc asks for
# that, and it is the fallback when the certificate cannot be made.
#
# Each run writes two logs in ~/Library/Logs/voice-meet-mac/:
#   app.log     the app's own lines: every event, state, format, count and error. All runs.
#   system.log  what macOS and its frameworks log for the app's process. This run only; the run
#               before it is system.previous.log.
set -eu

cd "$(dirname "$0")"

app=".build/iterate.app"
installed="${ITERATE_MAC_APP_INSTALL:-/Applications/iterate.app}"
# The app's own executables, as `ps` names them. A process counts as the app only when its
# executable is one of these files: a match on a name or on a command line would also find other
# programs.
executable="$(pwd -P)/$app/Contents/MacOS/iterate"
installed_executable="$installed/Contents/MacOS/iterate"
log_dir="$HOME/Library/Logs/voice-meet-mac"
signing_dir="$HOME/Library/Application Support/voice-meet-mac/signing"
signing_keychain="$signing_dir/signing.keychain-db"
signing_name="voice-meet-mac local signing"

app_processes() {
  for pid in $(pgrep -x iterate 2>/dev/null); do
    # args, not comm: a short copy that only answers a question (--check-screen-recording) is not
    # the app. A launch by Launch Services may add a `-psn_…` argument.
    command=$(ps -p "$pid" -o args= 2>/dev/null | sed 's/^ *//; s/ *$//')
    case "$command" in
    "$executable" | "$executable -psn"* | "$installed_executable" | "$installed_executable -psn"*)
      echo "$pid"
      ;;
    esac
  done
}

is_running() {
  [ -n "$(app_processes)" ]
}

# The app quits on a termination signal as on its Quit command: captures stop first.
quit_app() {
  is_running || return 0
  for pid in $(app_processes); do
    kill -TERM "$pid" 2>/dev/null || true
  done
  waited=0
  while is_running && [ "$waited" -lt 10 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if is_running; then
    echo "The prototype did not quit. Quit it by hand (the iterate mark in the menu bar, Quit iterate)." >&2
    exit 1
  fi
}

# Once: a self-signed code-signing certificate in a keychain of its own. The keychain's password
# is a random value in a file beside it; it guards nothing but this local certificate.
make_signing_identity() {
  (
    umask 077
    mkdir -p "$signing_dir"
    work=$(mktemp -d)
    trap 'rm -rf "$work"' EXIT
    password=$(/usr/bin/openssl rand -hex 24)
    printf '%s' "$password" >"$signing_dir/keychain-password"
    /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -keyout "$work/key.pem" -out "$work/certificate.pem" -subj "/CN=$signing_name" \
      -addext "keyUsage=critical,digitalSignature" \
      -addext "extendedKeyUsage=critical,codeSigning" \
      -addext "basicConstraints=critical,CA:false" 2>/dev/null
    /usr/bin/openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/certificate.pem" \
      -out "$work/identity.p12" -passout "pass:$password" -name "$signing_name"
    security create-keychain -p "$password" "$signing_keychain"
    security set-keychain-settings "$signing_keychain"
    security unlock-keychain -p "$password" "$signing_keychain"
    security import "$work/identity.p12" -k "$signing_keychain" -P "$password" -T /usr/bin/codesign >/dev/null
    # Lets codesign use the key with no dialog.
    security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$signing_keychain" >/dev/null
  )
}

# codesign finds a certificate only in a keychain of the user's search list. The signing keychain
# is on that list for the moment of signing and off it again after. `$1` is "add" or "remove".
list_signing_keychain() {
  others=$(security list-keychains -d user | sed -E 's/^ *"(.*)"$/\1/' | grep -vxF "$signing_keychain" || true)
  # An empty list would take the login keychain off the search list: change nothing then.
  [ -n "$others" ] || return 1
  old_ifs=$IFS
  IFS='
'
  # shellcheck disable=SC2086
  set -- "$1" $others
  IFS=$old_ifs
  mode=$1
  shift
  if [ "$mode" = "add" ]; then
    security list-keychains -d user -s "$@" "$signing_keychain"
  else
    security list-keychains -d user -s "$@"
  fi
}

sign_with_local_identity() {
  [ -f "$signing_keychain" ] || make_signing_identity || return 1
  security unlock-keychain -p "$(cat "$signing_dir/keychain-password")" "$signing_keychain" || return 1
  list_signing_keychain add || return 1
  trap 'list_signing_keychain remove' EXIT
  signed=0
  codesign --force --sign "$signing_name" "$app" 2>/dev/null || signed=1
  list_signing_keychain remove
  trap - EXIT
  return "$signed"
}

sign_app() {
  if [ "${VOICE_MEET_SIGN:-local}" != "adhoc" ] && sign_with_local_identity; then
    echo "Signed with the local certificate \"$signing_name\": permissions stay through rebuilds."
    return 0
  fi
  codesign --force --sign - "$app"
  echo "Signed ad hoc: macOS asks for the microphone again after each rebuild."
}

# The system's log for the app's process goes to a file for as long as the app runs. The app's own
# lines go to app.log by the app itself. `log` is also a shell builtin, so the path is given in full.
start_system_log() {
  mkdir -p "$log_dir"
  stream_pid_file="$log_dir/system-log-stream.pid"
  if [ -f "$stream_pid_file" ]; then
    old_pid=$(cat "$stream_pid_file")
    # Stop only a process that is still the log reader of an earlier run.
    if [ "$(ps -p "$old_pid" -o comm= 2>/dev/null)" = "/usr/bin/log" ]; then
      kill "$old_pid" 2>/dev/null || true
    fi
    rm -f "$stream_pid_file"
  fi
  if [ -f "$log_dir/system.log" ]; then
    mv -f "$log_dir/system.log" "$log_dir/system.previous.log"
  fi
  nohup /usr/bin/log stream --style compact --info --predicate 'process == "iterate" AND processImagePath ENDSWITH "iterate.app/Contents/MacOS/iterate"' \
    >"$log_dir/system.log" 2>&1 &
  stream_pid=$!
  echo "$stream_pid" >"$stream_pid_file"
}

# The log reader ends when the app ends: after a quit, and after a crash too.
end_system_log_with_the_app() {
  (
    waited=0
    while ! is_running && [ "$waited" -lt 15 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    while is_running; do
      sleep 2
    done
    sleep 1
    kill "$stream_pid" 2>/dev/null || true
    rm -f "$stream_pid_file"
  ) >/dev/null 2>&1 &
}

case "${1:-}" in
--logs)
  mkdir -p "$log_dir"
  touch "$log_dir/app.log" "$log_dir/system.log"
  if [ "${2:-}" = "system" ]; then
    exec tail -n 40 -F "$log_dir/system.log"
  fi
  exec tail -n 40 -F "$log_dir/app.log"
  ;;
--quit)
  quit_app
  exit 0
  ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script runs on a Mac only. On Linux, only VoiceMeetCore builds: swift test" >&2
  exit 1
fi

macos_major=$(sw_vers -productVersion | cut -d. -f1)
if [ "$macos_major" -lt 14 ]; then
  echo "macOS 14 or later is needed (SCContentSharingPicker). This Mac has $(sw_vers -productVersion)." >&2
  exit 1
fi

if ! xcrun --find swift >/dev/null 2>&1; then
  echo "No Swift toolchain. Install Xcode, or the Command Line Tools: xcode-select --install" >&2
  exit 1
fi

swift build -c release --product VoiceMeetMac
bin_path=$(swift build -c release --product VoiceMeetMac --show-bin-path)

rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$bin_path/VoiceMeetMac" "$app/Contents/MacOS/iterate"
cp Support/Info.plist "$app/Contents/Info.plist"
if [ -n "${ITERATE_MAC_APP_VERSION:-}" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $ITERATE_MAC_APP_VERSION" "$app/Contents/Info.plist"
fi
mkdir -p "$app/Contents/Resources"
cp Support/AppIcon.icns "$app/Contents/Resources/AppIcon.icns"
sign_app

echo "Built $(pwd)/$app"
if [ "${1:-}" = "--build-only" ]; then
  exit 0
fi

# Install: the running copy quits (its captures stop), the new build takes its place. The
# signature and the bundle identifier stay the same, so macOS keeps the permissions.
# Atomic: the new bundle is complete before the old one goes. The staging bundle goes too, so that
# one bundle alone has the app's identifier.
rm -rf "$installed.new"
ditto "$app" "$installed.new"
quit_app
rm -rf "$installed"
mv "$installed.new" "$installed"
rm -rf "$app"
echo "Installed $installed"
if [ "${1:-}" = "--install" ]; then
  exit 0
fi

start_system_log
open "$installed"
end_system_log_with_the_app

cat <<EOF
Opened. Look for the iterate mark in the menu bar: the app has no window and no Dock icon.
It starts by itself at each login. Run this script again to update it.
The logs:
  $log_dir/app.log      the app's own lines
  $log_dir/system.log   macOS and its frameworks, for the app's process
Follow the app's lines:  $(pwd)/run-on-mac.sh --logs
A crash report, if there is one:  ~/Library/Logs/DiagnosticReports/iterate-*.ips
EOF
