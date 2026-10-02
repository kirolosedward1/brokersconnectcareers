#!/usr/bin/env bash
# The App Store screenshots, and a smoke run of the store build on the way
# (docs/app-store.md, "Screenshots"). .github/workflows/ios-screens.yml runs it
# after building the app in Release; on a Mac with Xcode 26 and Maestro:
#
#   scripts/store-screens.sh <BrokersConnect.app> <output folder>
#
# Each pass is a fresh simulator in Arabic (Egypt), the status bar at 9:41 with
# full bars, the app installed and opened as by someone new, and the screens
# of maestro/screens.yaml opened by link, checked and captured:
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

# pass <name> <device type> <content size> <flow>
pass() {
  local name="$1" type="$2" size="$3" flow="$4" udid status=0
  echo "::group::$name"
  udid=$(xcrun simctl create "store-$name" "$type" "$runtime")
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b > /dev/null
  # Arabic, Egypt; the system reads it at boot.
  xcrun simctl spawn "$udid" defaults write 'Apple Global Domain' AppleLanguages -array ar-EG
  xcrun simctl spawn "$udid" defaults write 'Apple Global Domain' AppleLocale -string ar_EG
  xcrun simctl shutdown "$udid"
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b > /dev/null
  xcrun simctl ui "$udid" content_size "$size"
  xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  xcrun simctl install "$udid" "$app"

  mkdir -p "$out/$name"
  touch "$out/$name/.started"
  (cd "$out/$name" && maestro --device "$udid" test "${envs[@]}" --debug-output "$out/$name/debug" "$flows/$flow") || status=$?
  # takeScreenshot writes into Maestro's workspace, which is where it ran or,
  # for some versions, the flows' own folder: the pass's shots come from either.
  find "$flows" -maxdepth 1 -type f -name '[0-9]-*.png' -newer "$out/$name/.started" -exec mv {} "$out/$name/" \;
  if [ "$status" -ne 0 ]; then
    failed+=("$name")
    # What the screen showed when it failed.
    xcrun simctl io "$udid" screenshot "$out/$name/failed.png" || true
    echo "::error::$name: the screens did not all open cleanly (maestro exited $status)"
  fi
  xcrun simctl shutdown "$udid" || true
  xcrun simctl delete "$udid" || true
  echo "::endgroup::"
}

pass store "$iphone" large store.yaml
pass dark "$iphone" large dark.yaml
pass large-text "$iphone" accessibility-extra-extra-extra-large store.yaml
pass ipad "$ipad" large store.yaml

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
