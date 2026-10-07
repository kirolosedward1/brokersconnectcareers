#!/usr/bin/env bash
# The App Store screenshots, and a smoke run of the store build on the way
# (docs/app-store.md, "Screenshots"). .github/workflows/ios-screens.yml runs it
# after building the app in Release; on a Mac with Xcode 26 and Maestro:
#
#   scripts/store-screens.sh <BrokersConnect.app> <output folder>
#
# Each pass runs on a simulator in Arabic (Egypt), the status bar at 9:41 with
# full bars, opens the app as someone new would, and opens the screens of
# maestro/screens.yaml by link, checking and capturing each (the store and
# large-text passes then check the signed-out screens, maestro/signed-out.yaml);
# a failed pass writes what was on the screen into the log:
#
#   store       the largest iPhone, light: the screenshots App Store Connect
#               asks for (6.9-inch)
#   dark        the same iPhone, the dark appearance chosen in the app
#   large-text  the same iPhone at the largest accessibility text size
#   ipad        the largest iPad, where App Review also opens an iPhone app,
#               checked by sight (ipad_pass, below)
#
# PASSES="ipad" (or any of the names above, space-separated) runs only those.
#
# What they show is the live site's: the first listing and the first company
# it lists. Where it lists none, the board or the company list is checked empty
# and the page it would lead to is left out, with a warning: the set is then a
# smoke run, not the store's screenshots. A crash, an error screen or a screen
# that never loads fails the pass; every pass runs, and the script fails if any
# did.
set -euo pipefail

app="$1"
out="$2"
here="$(cd "$(dirname "$0")" && pwd)"
flows="$(cd "$here/../maestro" && pwd)"
site="${EXPO_PUBLIC_SITE_URL:-https://www.brokersconnect.net}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

# A listing and a company to open, as Maestro patterns: their names are
# matched as regular expressions, so ( ) . + and the like are escaped. Never
# App Review's own (supabase/review-accounts.sql), which say they are no real
# job: the store's screenshots would show them.
live=$(SITE="$site" node --input-type=module -e '
  const read = async (path) => {
    const response = await fetch(process.env.SITE + path);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  };
  const pattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const review = (slug) => slug.startsWith("app-review-") || slug === "brokers-connect-app-review";
  const job = (await read("/api/mobile/v1/jobs")).jobs.find((row) => !review(row.slug));
  const company = (await read("/api/mobile/v1/companies")).companies.find((row) => !review(row.slug));
  console.log(JSON.stringify({
    JOB_SLUG: job?.slug ?? "none",
    JOB_TITLE: job ? pattern(job.title_ar) : "none",
    COMPANY_SLUG: company?.slug ?? "none",
    COMPANY_NAME: company ? pattern(company.name_ar) : "none",
  }));
')
echo "$live" | jq . > "$out/live.json"
cat "$out/live.json"
job_slug=$(jq -r .JOB_SLUG <<<"$live")
company_slug=$(jq -r .COMPANY_SLUG <<<"$live")
if [ "$job_slug" = none ]; then
  echo "::warning::The live site has no live listing: the board is checked empty and the listing page is left out. These are not the store's screenshots; run this again once listings are live."
fi
if [ "$company_slug" = none ]; then
  echo "::warning::The live site lists no company: the company list is checked empty and the company page is left out."
fi
envs=()
while IFS= read -r pair; do envs+=(-e "$pair"); done < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' <<<"$live")
# The same names as plain text, for reading off a screen (ipad_pass).
job_title=$(jq -r '.JOB_TITLE | gsub("\\\\(?<c>.)"; "\(.c)")' <<<"$live")
company_name=$(jq -r '.COMPANY_NAME | gsub("\\\\(?<c>.)"; "\(.c)")' <<<"$live")

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

# macOS's text recognition (screen-text.swift), built once: the iPad pass
# reads its screens with it, and a failed pass prints what it read.
tools=$(mktemp -d)
swiftc -O "$here/screen-text.swift" -o "$tools/screen-text" > "$tools/swiftc.log" 2>&1 ||
  { cat "$tools/swiftc.log"; echo "::error::scripts/screen-text.swift did not build"; exit 1; }
ocr="$tools/screen-text"

# The states a screen must not show: maestro/checks.yaml's, one list for both.
refused=()
while IFS= read -r phrase; do refused+=("$phrase"); done < <(sed -nE 's/^- assertNotVisible: "(.*)"$/\1/p' "$flows/checks.yaml")
[ "${#refused[@]}" -gt 0 ] || { echo "::error::maestro/checks.yaml's phrases were not found"; exit 1; }

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
# and what the app logged.
# In a subshell that stops for nothing: a diagnosis never fails the run.
explain() (
  set +eo pipefail
  name="$1" udid="$2"
  echo "The screen when $name failed, roughly:"
  python3 "$here/screen-sketch.py" "$out/$name/failed.png" 60 || echo "    (no sketch)"
  echo "The words on it, as macOS reads them:"
  "$ocr" "$out/$name/failed.png" 2> /dev/null | head -n 60 | sed 's/^/    /'
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

# annotate <name>: the step Maestro failed on and the words on the screen, as
# an annotation on the run — read where neither the log nor the artifact can
# be (through the API, as the run's check annotations).
annotate() (
  set +eo pipefail
  name="$1"
  {
    # A Maestro exception's own message is at its top, its stack below it.
    echo "Maestro's errors:"
    grep -E 'Exception|Error|Caused by|FAILED' "$out/$name/maestro.log" | grep -vE '^[[:space:]]+at ' | head -n 8
    echo "Maestro's last lines:"
    grep -v '^[[:space:]]*$' "$out/$name/maestro.log" | grep -vE '^[[:space:]]+at ' | tail -n 10
    echo "The screen, as macOS reads it:"
    "$ocr" "$out/$name/failed.png" 2> /dev/null | head -n 30
  } | cut -c 1-200 | python3 -c '
import sys
text = sys.stdin.read()[:3500]
print("::error title=" + sys.argv[1] + " pass::" + text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
' "$name"
)

# pass <name> <simulator> <content size> <flow>
pass() {
  local name="$1" udid="$2" size="$3" flow="$4" status=0
  echo "::group::$name"
  xcrun simctl ui "$udid" content_size "$size"
  mkdir -p "$out/$name"
  touch "$out/$name/.started"
  (cd "$out/$name" && maestro --device "$udid" test "${envs[@]}" --debug-output "$out/$name/debug" "$flows/$flow") \
    > "$out/$name/maestro.log" 2>&1 || status=$?
  cat "$out/$name/maestro.log"
  # takeScreenshot writes into Maestro's workspace, which is where it ran or,
  # for some versions, the flows' own folder: the pass's shots come from either.
  find "$flows" -maxdepth 1 -type f -name '[0-9]-*.png' -newer "$out/$name/.started" -exec mv {} "$out/$name/" \;
  if [ "$status" -ne 0 ]; then
    failed+=("$name")
    xcrun simctl io "$udid" screenshot "$out/$name/failed.png" > /dev/null 2>&1 || true
    explain "$name" "$udid"
    annotate "$name"
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

# see <simulator> <shot> <phrase>...: waits up to 90 seconds for the iPad's
# screen to show every phrase, as macOS's text recognition reads it
# (screen-check.py compares them), and fails at once on an error state. The
# screenshot and what was read stay as ipad/<shot>.png and .txt.
#
# iPadOS asks before opening the link ("Open in …?") a moment after it opens,
# sometimes only after Maestro has looked for the question and gone: when the
# question is what the screen shows, it is answered here (at most three times)
# and the screen read again.
see() {
  local udid="$1" shot="$2" phrase status answered=0 deadline=$((SECONDS + 90)) args=()
  shift 2
  for phrase in "$@"; do args+=(--expect "$phrase"); done
  for phrase in "${refused[@]}"; do args+=(--refuse "$phrase"); done
  echo "the screen could not be read" > "$out/ipad/why.txt"
  while :; do
    status=1
    if xcrun simctl io "$udid" screenshot "$out/ipad/$shot.png" > /dev/null 2>&1 &&
      "$ocr" "$out/ipad/$shot.png" > "$out/ipad/$shot.txt" 2> /dev/null; then
      status=0
      python3 "$here/screen-check.py" "${args[@]}" < "$out/ipad/$shot.txt" 2> "$out/ipad/why.txt" || status=$?
    fi
    if [ "$status" -eq 0 ]; then echo "$shot: checked"; return 0; fi
    if [ "$status" -eq 1 ] && [ "$answered" -lt 3 ] &&
      python3 "$here/screen-check.py" --expect 'فتح في "بروكرز كونكت"؟' < "$out/ipad/$shot.txt" 2> /dev/null; then
      answered=$((answered + 1))
      echo "$shot: iPadOS is still asking to open the link; answering it ($answered)"
      maestro --device "$udid" test "$flows/confirm-link.yaml" >> "$out/ipad/links.log" 2>&1 || true
      continue
    fi
    if [ "$status" -eq 2 ] || [ "$SECONDS" -ge "$deadline" ]; then
      echo "$shot: $(cat "$out/ipad/why.txt")"
      return 1
    fi
    sleep 3
  done
}

# open_link <simulator> <path>: Maestro opens brokersconnect:///<path> as from
# outside the app, and answers when iPadOS asks first (maestro/link.yaml).
open_link() {
  if ! maestro --device "$1" test -e "LINK=brokersconnect:///$2" "$flows/link.yaml" >> "$out/ipad/links.log" 2>&1; then
    echo "Maestro could not open /$2:"
    tail -n 15 "$out/ipad/links.log" | sed 's/^/    /'
    return 1
  fi
}

# The iPad, by sight. App Review opens an iPhone app on an iPad too, which
# iPadOS 26 draws in a window of its own, and there Maestro loses the app: it
# read it at launch, but after the first link (iPadOS asks "Open in …?"
# first) its driver placed the window wrongly and read none of the app's
# words while macOS read them all on the screen. So here Maestro only opens
# the links and answers that question; each screen is checked by what macOS's
# text recognition reads on it: the words that screen shows, as in
# maestro/screens.yaml, and none of the error states.
ipad_pass() {
  local udid="$1" board directory
  board=$([ "$job_slug" = none ] && echo 'مفيش وظائف مطابقة لبحثك.' || echo "$job_title")
  directory=$([ "$company_slug" = none ] && echo 'مفيش شركات مطابقة.' || echo "$company_name")
  echo "::group::ipad"
  mkdir -p "$out/ipad"
  touch "$out/ipad/.started"
  if xcrun simctl launch "$udid" net.brokersconnect.app > /dev/null &&
    see "$udid" 1-home 'منصة متخصصة لوظائف العقارات في مصر' &&
    open_link "$udid" jobs && see "$udid" 2-jobs 'الفلاتر' "$board" &&
    { [ "$job_slug" = none ] || { open_link "$udid" "jobs/$job_slug" && see "$udid" 3-listing 'مشاركة' "$job_title"; }; } &&
    open_link "$udid" companies && see "$udid" 4-companies "$directory" &&
    { [ "$company_slug" = none ] || { open_link "$udid" "companies/$company_slug" && see "$udid" 5-company "$company_name"; }; }; then
    echo "ipad: every screen opened cleanly"
  else
    failed+=(ipad)
    xcrun simctl io "$udid" screenshot "$out/ipad/failed.png" > /dev/null 2>&1 || true
    explain ipad "$udid"
    echo "::error::ipad: the screens did not all open cleanly"
  fi
  echo "::endgroup::"
}

if wants ipad; then
  tablet=$(device ipad "$ipad")
  ipad_pass "$tablet"
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
