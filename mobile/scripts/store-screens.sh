#!/usr/bin/env bash
# The App Store screenshots, and a smoke run of the store build on the way
# (docs/app-store.md, "Screenshots"). .github/workflows/ios-screens.yml runs it
# after building the app in Release; on a Mac with Xcode 26 and Maestro:
#
#   scripts/store-screens.sh <BrokersConnect.app> <output folder>
#
# Each pass runs on a simulator in Arabic (Egypt), the status bar at 9:41 with
# full bars, opens the app as someone new would, and opens the screens of
# maestro/screens.yaml by link, checking and capturing each; a failed pass
# writes what was on the screen into the log:
#
#   store       the largest iPhone, light: the screenshots App Store Connect
#               asks for (6.9-inch)
#   dark        the same iPhone, the dark appearance chosen in the app
#   large-text  the same iPhone at the largest accessibility text size
#   ipad        the largest iPad, where App Review also opens an iPhone app
#
# PASSES="ipad" (or any of the names above, space-separated) runs only those.
#
# What they show is the live site's: the first listing and the first company
# it lists. With none, the board and the company list are checked empty and the
# pages they lead to are left out, with a warning: the set is then a smoke run,
# not the store's screenshots. A crash, an error screen or a screen that never
# loads fails the pass; every pass runs, and the script fails if any did.
set -euo pipefail

app="$1"
out="$2"
here="$(cd "$(dirname "$0")" && pwd)"
flows="$(cd "$here/../maestro" && pwd)"
site="${EXPO_PUBLIC_SITE_URL:-https://www.brokersconnect.net}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

# A listing and a company to open, as Maestro patterns: their names are
# matched as regular expressions, so ( ) . + and the like are escaped.
live=$(SITE="$site" node --input-type=module -e '
  const read = async (path) => {
    const response = await fetch(process.env.SITE + path);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  };
  const pattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const { jobs } = await read("/api/mobile/v1/jobs");
  const { companies } = await read("/api/mobile/v1/companies");
  console.log(JSON.stringify({
    JOB_SLUG: jobs[0]?.slug ?? "none",
    JOB_TITLE: jobs[0] ? pattern(jobs[0].title_ar) : "none",
    COMPANY_SLUG: companies[0]?.slug ?? "none",
    COMPANY_NAME: companies[0] ? pattern(companies[0].name_ar) : "none",
  }));
')
echo "$live" | jq . > "$out/live.json"
cat "$out/live.json"
# The company list holds only companies with a live listing, so it is empty
# exactly when the board is.
if [ "$(jq -r .JOB_SLUG <<<"$live")" = none ]; then
  echo "::warning::The live site has no live listing: the board and the company list are checked empty, and the listing and company pages are left out. These are not the store's screenshots; run this again once listings are live."
fi
envs=()
while IFS= read -r pair; do envs+=(-e "$pair"); done < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' <<<"$live")

passes=" ${PASSES:-store dark large-text ipad} "
for wanted in $passes; do
  case "$wanted" in
    store | dark | large-text | ipad) ;;
    *) echo "::error::no pass is called $wanted (store, dark, large-text, ipad)"; exit 1 ;;
  esac
done
wants() { [[ "$passes" == *" $1 "* ]]; }

runtime=$(xcrun simctl list runtimes -j |
  jq -r '[.runtimes[] | select(.platform == "iOS" and .isAvailable)] | sort_by(.version | split(".") | map(tonumber)) | last | .identifier')
[ -n "$runtime" ] && [ "$runtime" != null ] || { echo "::error::no iOS simulator runtime"; exit 1; }

# The first of these device types this Xcode has.
device_type() {
  local name id
  for name in "$@"; do
    id=$(xcrun simctl list devicetypes -j | jq -r --arg name "$name" '.devicetypes[] | select(.name == $name) | .identifier')
    if [ -n "$id" ]; then echo "$id"; return 0; fi
  done
  echo "::error::none of these simulators exists: $*" >&2
  return 1
}
iphone=$(device_type 'iPhone 17 Pro Max' 'iPhone 16 Pro Max')
ipad=$(device_type 'iPad Pro 13-inch (M5)' 'iPad Pro 13-inch (M4)' 'iPad Air 13-inch (M3)' 'iPad Air 13-inch (M2)')
printf 'runtime %s\niphone %s\nipad %s\n' "$runtime" "$iphone" "$ipad" | tee "$out/devices.txt"

failed=()

# device <name> <device type>: a fresh simulator in Arabic (Egypt), the
# status bar at 9:41 with full bars and the app installed; prints its id.
device() {
  local udid
  udid=$(xcrun simctl create "store-$1" "$2" "$runtime")
  {
    xcrun simctl boot "$udid"
    xcrun simctl bootstatus "$udid" -b
    # The system reads the language at boot.
    xcrun simctl spawn "$udid" defaults write 'Apple Global Domain' AppleLanguages -array ar-EG
    xcrun simctl spawn "$udid" defaults write 'Apple Global Domain' AppleLocale -string ar_EG
    xcrun simctl shutdown "$udid"
    xcrun simctl boot "$udid"
    xcrun simctl bootstatus "$udid" -b
    xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
      --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
    xcrun simctl install "$udid" "$app"
  } > /dev/null
  echo "$udid"
}

# What a failed pass left on the screen, in the run's log, which can be read
# where its artifact cannot: a sketch of the screen, its words as macOS reads
# them and as Maestro does, whether the app is still running, any crash report,
# what Maestro's driver made of the apps it saw, and what the app logged.
# In a subshell that stops for nothing: a diagnosis never fails the run.
explain() (
  set +eo pipefail
  name="$1" udid="$2"
  echo "The screen when $name failed, roughly:"
  python3 "$here/screen-sketch.py" "$out/$name/failed.png" 60 || echo "    (no sketch)"
  echo "The words on it, as macOS reads them:"
  swift "$here/screen-text.swift" "$out/$name/failed.png" 2>&1 | head -n 60 | sed 's/^/    /'
  echo "The words on it, as Maestro reads them:"
  if maestro --device "$udid" hierarchy > "$out/$name/hierarchy.json" 2> /dev/null; then
    jq -r '[.. | objects | .attributes? // empty | (.accessibilityText // empty), (.text // empty), (.title // empty)
            | select(type == "string" and . != "")] | unique | .[]' "$out/$name/hierarchy.json" | head -n 80 | sed 's/^/    /'
  else
    echo "    (Maestro could not read the screen)"
  fi
  # Read whole, then searched: grep -q stopping early would kill launchctl
  # with SIGPIPE and read as "not running".
  echo "Apps running on the simulator (pid, last exit status, label):"
  xcrun simctl spawn "$udid" launchctl list > "$out/$name/launchctl.txt" 2>&1
  grep 'UIKitApplication:' "$out/$name/launchctl.txt" | sed 's/^/    /'
  grep -q 'UIKitApplication:net.brokersconnect.app' "$out/$name/launchctl.txt" || echo "    (not the app)"
  echo "Crash reports since the pass began:"
  find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 2 -type f -name 'BrokersConnect*' -newer "$out/$name/.started" \
    2> /dev/null > "$out/$name/crashes.txt"
  [ -s "$out/$name/crashes.txt" ] || echo "    none"
  while IFS= read -r report; do
    cp "$report" "$out/$name/"
    echo "    $(basename "$report")"
    tail -n +2 "$report" | jq -r '. as $r
      | "    exception: \(.exception // "none" | tostring)",
        "    termination: \(.termination // "none" | tostring)",
        "    application specific: \(.asi // "none" | tostring)",
        ((.lastExceptionBacktrace // [])[0:25][] | "      exception \($r.usedImages[.imageIndex].name // "?") \(.symbol // "?")"),
        ((.threads[.faultingThread // 0].frames // [])[0:25][] | "      crashed \($r.usedImages[.imageIndex].name // "?") \(.symbol // "?")")' |
      cut -c 1-400
  done < "$out/$name/crashes.txt"
  echo "What Maestro's driver said about the apps it saw (the last 30 such lines):"
  xcrun simctl spawn "$udid" log show --last 15m --style compact --predicate 'process BEGINSWITH "maestro-driver"' 2> /dev/null |
    grep -iE 'running app|foreground|springboard|snapshot|hierarchy|error' | tail -n 30 | cut -c 1-300 | sed 's/^/    /'
  # The test driver's own queries run inside the app's process: left out.
  log="$out/$name/app.log"
  xcrun simctl spawn "$udid" log show --last 15m --style compact \
    --predicate 'process == "BrokersConnect" AND NOT subsystem BEGINSWITH "com.apple.dt.xctest"' 2> /dev/null |
    grep -v '^Timestamp' > "$log"
  echo "What the app logged in the last 15 minutes: $(grep -c . "$log") lines, by subsystem:"
  grep -oE 'BrokersConnect\[[0-9a-f:]+\] \[[^]:]+' "$log" | sed 's/.*\[//' | sort | uniq -c | sort -rn | head -n 15 | sed 's/^/    /'
  echo "The first 25 lines:"
  head -n 25 "$log" | cut -c 1-400 | sed 's/^/    /'
  echo "Its errors, faults and React Native's lines (the last 50):"
  awk '$3 == "E" || $3 == "F" || /com\.facebook\.react/' "$log" | tail -n 50 | cut -c 1-400 | sed 's/^/    /'
)

# The apps the simulator started on its own, closed (iPadOS starts Calendar):
# Maestro reads the screen of the app it finds in front.
close_others() {
  local udid="$1" other
  for other in $(xcrun simctl spawn "$udid" launchctl list 2> /dev/null |
    sed -nE 's/.*UIKitApplication:([^[]+)\[.*/\1/p' | grep -vx 'net.brokersconnect.app' || true); do
    echo "Closing $other, which the simulator started"
    xcrun simctl terminate "$udid" "$other" > /dev/null 2>&1 || true
  done
}

# pass <name> <simulator> <content size> <flow>
pass() {
  local name="$1" udid="$2" size="$3" flow="$4" status=0
  echo "::group::$name"
  xcrun simctl ui "$udid" content_size "$size"
  mkdir -p "$out/$name"
  touch "$out/$name/.started"
  close_others "$udid"
  (cd "$out/$name" && maestro --device "$udid" test "${envs[@]}" --debug-output "$out/$name/debug" "$flows/$flow") || status=$?
  # takeScreenshot writes into Maestro's workspace, which is where it ran or,
  # for some versions, the flows' own folder: the pass's shots come from either.
  find "$flows" -maxdepth 1 -type f -name '[0-9]-*.png' -newer "$out/$name/.started" -exec mv {} "$out/$name/" \;
  if [ "$status" -ne 0 ]; then
    failed+=("$name")
    xcrun simctl io "$udid" screenshot "$out/$name/failed.png" > /dev/null 2>&1 || true
    explain "$name" "$udid"
    echo "::error::$name: the screens did not all open cleanly (maestro exited $status)"
  fi
  echo "::endgroup::"
}

# One iPhone for its three passes: each starts the app afresh (launch.yaml).
if wants store || wants dark || wants large-text; then
  phone=$(device iphone "$iphone")
  if wants store; then pass store "$phone" large store.yaml; fi
  if wants dark; then pass dark "$phone" large dark.yaml; fi
  if wants large-text; then pass large-text "$phone" accessibility-extra-extra-extra-large store.yaml; fi
  xcrun simctl shutdown "$phone" || true
  xcrun simctl delete "$phone" || true
fi

if wants ipad; then
  tablet=$(device ipad "$ipad")
  pass ipad "$tablet" large store.yaml
  xcrun simctl shutdown "$tablet" || true
  xcrun simctl delete "$tablet" || true
fi

# The sizes App Store Connect checks a 6.9-inch screenshot against.
if [ -d "$out/store" ]; then
  echo "Store screenshots:"
  find "$out/store" -name '*.png' ! -path '*/debug/*' ! -name failed.png | sort | while read -r shot; do
    printf '  %s %sx%s\n' "${shot#"$out/"}" "$(sips -g pixelWidth "$shot" | awk '/pixelWidth/ {print $2}')" \
      "$(sips -g pixelHeight "$shot" | awk '/pixelHeight/ {print $2}')"
  done
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::failed: ${failed[*]}"
  exit 1
fi
