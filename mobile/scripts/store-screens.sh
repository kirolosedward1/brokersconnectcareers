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
# What they show is the live site's: the first listing and the first company
# it lists. With none, the board and the company list are checked empty and the
# pages they lead to are left out, with a warning: the set is then a smoke run,
# not the store's screenshots. A crash, an error screen or a screen that never
# loads fails the pass; every pass runs, and the script fails if any did.
set -euo pipefail

app="$1"
out="$2"
flows="$(cd "$(dirname "$0")/../maestro" && pwd)"
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
# where its artifact cannot: the words Maestro sees, whether the app is still
# running, and what it logged as errors.
explain() {
  local name="$1" udid="$2"
  echo "On screen when $name failed:"
  if maestro --device "$udid" hierarchy > "$out/$name/hierarchy.json" 2> /dev/null; then
    jq -r '[.. | objects | .attributes? // empty | (.accessibilityText // empty), (.text // empty), (.title // empty)
            | select(type == "string" and . != "")] | unique | .[]' "$out/$name/hierarchy.json" | head -n 80 | sed 's/^/    /'
  else
    echo "    (Maestro could not read the screen)"
  fi
  if xcrun simctl spawn "$udid" launchctl list | grep -q 'UIKitApplication:net.brokersconnect.app'; then
    echo "The app is running."
  else
    echo "The app is not running."
  fi
  echo "What the app logged as errors in the last 10 minutes:"
  xcrun simctl spawn "$udid" log show --last 10m --style compact \
    --predicate 'process == "BrokersConnect" AND (messageType == error OR messageType == fault OR eventMessage CONTAINS[c] "error")' 2> /dev/null |
    grep -v '^Timestamp' | tail -n 40 | cut -c 1-400 | sed 's/^/    /'
}

# pass <name> <simulator> <content size> <flow>
pass() {
  local name="$1" udid="$2" size="$3" flow="$4" status=0
  echo "::group::$name"
  xcrun simctl ui "$udid" content_size "$size"
  mkdir -p "$out/$name"
  touch "$out/$name/.started"
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
phone=$(device iphone "$iphone")
pass store "$phone" large store.yaml
pass dark "$phone" large dark.yaml
pass large-text "$phone" accessibility-extra-extra-extra-large store.yaml
xcrun simctl shutdown "$phone" || true
xcrun simctl delete "$phone" || true

tablet=$(device ipad "$ipad")
pass ipad "$tablet" large store.yaml
xcrun simctl shutdown "$tablet" || true
xcrun simctl delete "$tablet" || true

# The sizes App Store Connect checks a 6.9-inch screenshot against.
echo "Store screenshots:"
find "$out/store" -name '*.png' ! -path '*/debug/*' ! -name failed.png | sort | while read -r shot; do
  printf '  %s %sx%s\n' "${shot#"$out/"}" "$(sips -g pixelWidth "$shot" | awk '/pixelWidth/ {print $2}')" \
    "$(sips -g pixelHeight "$shot" | awk '/pixelHeight/ {print $2}')"
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::failed: ${failed[*]}"
  exit 1
fi
