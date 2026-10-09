#!/usr/bin/env bash
# The app as the owner's iPhone opens it: the newest update on the expo-go
# channel, opened from Expo's servers in Expo Go on an iPhone simulator, and
# read back (docs/mobile.md, "Trying it in Expo Go"). The Expo Go job in
# .github/workflows/expo-go.yml runs it after each publish; on a Mac with
# Xcode 26, Maestro and jq:
#
#   scripts/expo-go-look.sh <output folder>
#
# What it is for is which way the app runs where it broke: Expo Go creates the
# screen before it applies the app's right to left when it opens an update
# from the network and when it comes back from its own home screen, and lays
# its bars out in its own language — English here, as on an iPhone set to
# English. So it opens the update — the welcome, then Home — and three screens
# by link, then goes back to Expo Go's home and opens the app again from there:
# the welcome once more, as every launch with nobody signed in opens on it,
# then Home. Each screen
# is read by macOS's text recognition with where every line sits (percent of
# the screen: how far down, left and right edges), into the run's log and its
# annotations, with a verdict on the tab bar: Home must be its rightmost tab.
#
# Each tab's title is looked for in its header's bar too, not only as its name
# in the tab bar: iOS 26 left the tabs' large titles empty until the screen
# was scrolled, then drew them mirrored, and the tabs now take the bar's own
# title. And the board is scrolled down and back up: scrolled down, the tab
# bar grows smaller and its names go (src/components/navigation/tab-bar.tsx),
# so none is read; scrolled back up, all four are read again.
#
# A screen that never shows what it should, a tab without its title, or a tab
# bar laid out left to right, fails it.
set -euo pipefail

out="$1"
here="$(cd "$(dirname "$0")" && pwd)"
flows="$(cd "$here/../maestro" && pwd)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

project=$(sed -nE "s/^const EAS_PROJECT_ID: string \| null = '([^']+)';/\1/p" "$here/../app.config.ts")
[ -n "$project" ] || { echo "::error::no EAS project id in app.config.ts"; exit 1; }
sdk="$(node -p "require('$here/../package.json').dependencies.expo.replace(/[^0-9.]/g, '').split('.')[0]").0.0"
query="channel-name=expo-go&runtime-version=exposdk:$sdk"
# link [path]: the channel's newest update in Expo Go, opened at a path of the app's.
link() { if [ -n "${1:-}" ]; then echo "exp://u.expo.dev/$project/--/$1?$query"; else echo "exp://u.expo.dev/$project?$query"; fi; }

# Expo Go for the simulator, the build Expo serves for this SDK.
work=$(mktemp -d)
client=$(curl -fsS https://api.expo.dev/v2/versions/latest |
  jq -r --arg sdk "$sdk" '.data.sdkVersions[$sdk] | "\(.iosClientUrl // "") \(.iosClientVersion // "")"')
read -r client_url client_version <<<"$client"
[ -n "$client_url" ] || { echo "::error::Expo serves no Expo Go simulator build for SDK $sdk"; exit 1; }
echo "Expo Go $client_version for SDK $sdk; project $project"
curl -fsSL "$client_url" -o "$work/expo-go.tar.gz"
mkdir "$work/ExpoGo.app"
tar -xzf "$work/expo-go.tar.gz" -C "$work/ExpoGo.app"

runtime=$(xcrun simctl list runtimes -j |
  jq -r '[.runtimes[] | select(.platform == "iOS" and .isAvailable)] | sort_by(.version | split(".") | map(tonumber)) | last | .identifier')
[ -n "$runtime" ] && [ "$runtime" != null ] || { echo "::error::no iOS simulator runtime"; exit 1; }
type=""
for name in 'iPhone 17 Pro' 'iPhone 16 Pro' 'iPhone 17 Pro Max' 'iPhone 16 Pro Max'; do
  type=$(xcrun simctl list devicetypes -j | jq -r --arg name "$name" '.devicetypes[] | select(.name == $name) | .identifier')
  [ -n "$type" ] && break
done
[ -n "$type" ] || { echo "::error::no iPhone simulator"; exit 1; }
udid=$(xcrun simctl create expo-go "$type" "$runtime")
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b > "$work/boot.log"
xcrun simctl install "$udid" "$work/ExpoGo.app"
# From here on, whatever Expo Go logs is the app's run (read back at the end).
started=$(date -u +%Y-%m-%dT%H:%M:%S)
echo "runtime $runtime, $type, simulator $udid"

swiftc -O "$here/screen-text.swift" -o "$work/screen-text" > "$work/swiftc.log" 2>&1 ||
  { cat "$work/swiftc.log"; echo "::error::scripts/screen-text.swift did not build"; exit 1; }
ocr="$work/screen-text"

refused=()
while IFS= read -r phrase; do refused+=("$phrase"); done < <(sed -nE 's/^- assertNotVisible: "(.*)"$/\1/p' "$flows/checks.yaml")

failed=()

# open_app [path]: the update opened at a path of the app's, as from outside
# Expo Go, answering iOS's "Open in …?" (maestro/expo-go-link.yaml).
open_app() {
  maestro --device "$udid" test -e "LINK=$(link "${1:-}")" "$flows/expo-go-link.yaml" >> "$out/maestro.log" 2>&1 ||
    { echo "Maestro could not open /${1:-}:"; tail -n 15 "$out/maestro.log" | sed 's/^/    /'; }
}

# close_menu: taps the X of Expo Go's developer menu, where the text
# recognition reads it on the screen (scripts/screen-text.swift --boxes); or,
# not read, swipes the menu down.
close_menu() {
  local point
  "$ocr" "$work/menu.png" --boxes > "$work/menu.boxes" 2> /dev/null || true
  point=$(python3 - "$work/menu.boxes" <<'PY'
import re, sys
for raw in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"y(-?\d+) x(-?\d+)-(-?\d+)  (.*)", raw.rstrip("\n"))
    if m and m[4].strip() in ("X", "x", "×") and int(m[2]) > 60:
        print(f"{(int(m[2]) + int(m[3])) // 2}%,{int(m[1]) + 1}%")
        break
PY
  )
  if [ -n "$point" ]; then
    maestro --device "$udid" test -e "POINT=$point" "$flows/expo-go-tap.yaml" >> "$out/maestro.log" 2>&1 || true
  else
    maestro --device "$udid" test "$flows/expo-go-swipe-down.yaml" >> "$out/maestro.log" 2>&1 || true
  fi
}

# see <shot> <phrase>...: reads the screen until it shows every phrase (up to
# three minutes: the first open downloads the update), answering Expo Go's
# first-time tour of its developer menu on the way. Fails at once on an error
# state. Leaves <shot>.png, .txt (the words) and .boxes (where they sit).
see() {
  local shot="$1" status deadline=$((SECONDS + 180)) args=()
  shift
  for phrase in "$@"; do args+=(--expect "$phrase"); done
  for phrase in "${refused[@]}"; do args+=(--refuse "$phrase"); done
  while :; do
    status=1
    if xcrun simctl io "$udid" screenshot "$out/$shot.png" > /dev/null 2>&1 &&
      "$ocr" "$out/$shot.png" > "$out/$shot.txt" 2> /dev/null; then
      # Expo Go's tour of its developer menu, or iOS asking about notifications,
      # over the app: answered first, or it hides the tab bar from the reading.
      if grep -qE '^(Continue|Allow)$' "$out/$shot.txt"; then
        maestro --device "$udid" test "$flows/expo-go-alerts.yaml" >> "$out/maestro.log" 2>&1 || true
        sleep 2
        continue
      fi
      # The developer menu itself, which the tour leaves open over the app:
      # closed with its X, found where the text recognition read it.
      if grep -qE '^(Go home|SDK Version)$' "$out/$shot.txt"; then
        cp "$out/$shot.png" "$work/menu.png"
        close_menu
        sleep 2
        continue
      fi
      status=0
      python3 "$here/screen-check.py" "${args[@]}" < "$out/$shot.txt" 2> "$out/$shot.why" || status=$?
    fi
    if [ "$status" -eq 0 ]; then break; fi
    if [ "$status" -eq 2 ] || [ "$SECONDS" -ge "$deadline" ]; then
      failed+=("$shot")
      echo "::error title=Expo Go: $shot::$(cat "$out/$shot.why" 2> /dev/null || echo 'the screen could not be read')"
      break
    fi
    sleep 3
  done
  "$ocr" "$out/$shot.png" --boxes > "$out/$shot.boxes" 2> /dev/null || true
  report "$shot"
}

# report <shot> [note]: where the words sit, and whether the tab bar runs
# right to left, into the log and (the first ten) as annotations.
report() (
  set +eo pipefail
  shot="$1"
  note="${2:+ ($2)}"
  verdict=$(python3 - "$out/$shot.boxes" <<'PY'
import re, sys
lines = []
for raw in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"y(-?\d+) x(-?\d+)-(-?\d+)  (.*)", raw.rstrip("\n"))
    if m:
        lines.append((int(m[1]), int(m[2]), int(m[3]), m[4]))
def centre(word):
    found = [(x0 + x1) / 2 for y, x0, x1, text in lines if y >= 85 and text.strip() == word]
    return found[0] if found else None
home, account = centre("الرئيسية"), centre("حسابي")
if home is None or account is None:
    print("tab bar: not read")
elif home > account:
    print("tab bar: right to left (Home at the right)")
else:
    print("tab bar: LEFT TO RIGHT (Home at the left)")
PY
  )
  echo "::group::$shot — $verdict$note"
  cat "$out/$shot.boxes"
  echo "::endgroup::"
  echo "$verdict" > "$out/$shot.verdict"
  text="$verdict$note"$'\n'"$(head -n 40 "$out/$shot.boxes")"
  python3 -c '
import sys
text = sys.stdin.read()[:3800]
print("::notice title=Expo Go: " + sys.argv[1] + "::" + text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
' "$shot" <<<"$text"
)

# in_header <shot> <title>: the screen's title, read where the header's bar
# draws it — between 5% and 12% of the way down, under the status bar — and
# not only as the tab's name in the bar at the bottom.
in_header() {
  if ! python3 "$here/screen-check.py" --band 5-12 --expect "$2" < "$out/$1.boxes" 2> "$out/$1.header"; then
    failed+=("$1: no title")
    echo "::error title=Expo Go: $1::the title «$2» is not in the header"
  fi
}

# glance <shot> <what was done>: the screen as it is now, read and reported.
glance() {
  sleep 2
  xcrun simctl io "$udid" screenshot "$out/$1.png" > /dev/null 2>&1 || true
  "$ocr" "$out/$1.png" --boxes > "$out/$1.boxes" 2> /dev/null || true
  report "$1" "$2"
}

# skip: answers the welcome the way someone looking around does, with Skip
# (maestro/expo-go-browse.yaml), onto Home — known by its tab bar, as the
# welcome has the headline too.
skip() {
  maestro --device "$udid" test "$flows/expo-go-browse.yaml" >> "$out/maestro.log" 2>&1 ||
    { echo "Maestro could not answer the welcome:"; tail -n 15 "$out/maestro.log" | sed 's/^/    /'; }
}

# bar_names <shot>: how many of the signed-out tab bar's four names are read at
# the foot of the screen.
bar_names() {
  python3 - "$out/$1.boxes" <<'PY'
import re, sys
names = {"الرئيسية", "الوظائف", "الشركات", "حسابي"}
read = set()
for raw in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"y(-?\d+) x(-?\d+)-(-?\d+)  (.*)", raw.rstrip("\n"))
    if m and int(m[1]) >= 85 and m[4].strip() in names:
        read.add(m[4].strip())
print(len(read))
PY
}

# Each step's Maestro run is kept apart and shown with the step's reading:
# whether it found what it was to tap, and what it saw of the screen.
step_run() {
  local name="$1"
  shift
  if maestro --device "$udid" test "$@" > "$out/$name.maestro.log" 2>&1; then
    echo "maestro: ok" > "$out/$name.maestro.verdict"
  else
    echo "maestro: FAILED" > "$out/$name.maestro.verdict"
  fi
}
# word_point <shot> <word>: the middle of where the text recognition read
# <word> on <shot>, in percent ("62%,17%"); nothing if it is not there.
# Maestro's own text and id selectors place an element of a screen laid out
# right to left at its mirror image: its tap on the filter sheet's X landed on
# Expo Go's floating button at the other edge and opened Expo Go's menu.
word_point() {
  python3 - "$out/$1.boxes" "$2" <<'PY'
import re, sys
want = sys.argv[2]
for raw in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"y(-?\d+) x(-?\d+)-(-?\d+)  (.*)", raw.rstrip("\n"))
    if m and want in m[4]:
        print(f"{(int(m[2]) + int(m[3])) // 2}%,{int(m[1]) + 1}%")
        break
PY
}
last_shot=""
# tap_word <step> <what> <word> [point if not read]: taps the word where it was read on the last screen.
tap_word() {
  local name="$1" what="$2" word="$3" fallback="${4:-}" point
  point=$(word_point "$last_shot" "$word")
  point="${point:-$fallback}"
  if [ -z "$point" ]; then
    echo "::group::$name — «${word}» not read on the screen; nothing tapped"
    echo "::endgroup::"
    glance "$name" "$what (not tapped)"
    last_shot="$name"
    return
  fi
  tour "$name" "$what (at $point)" -e "POINT=$point" "$flows/expo-go-tap.yaml"
}
tour() {
  local name="$1" what="$2"
  shift 2
  step_run "$name" "$@"
  glance "$name" "$what"
  last_shot="$name"
  echo "::group::$name — $(cat "$out/$name.maestro.verdict")"
  tail -n 12 "$out/$name.maestro.log"
  echo "::endgroup::"
}

# The first open, from the network: the case that came up left to right. A
# launch with nobody signed in opens on the welcome; skipping it goes on to Home.
open_app
see 1-welcome 'إنشاء حساب'
skip
see 2-home 'منصة متخصصة لوظائف العقارات في مصر' 'الرئيسية'
open_app jobs
see 3-jobs 'الفلاتر'
in_header 3-jobs 'الوظائف'
tour 3b-jobs-scrolled-down 'scrolled down: the bar smaller, its names gone' "$flows/expo-go-scroll-down.yaml"
if [ "$(bar_names 3b-jobs-scrolled-down)" != 0 ]; then
  failed+=("3b-jobs-scrolled-down: the tab bar kept its names")
  echo "::error title=Expo Go: 3b-jobs-scrolled-down::the tab bar's names are still read after scrolling down"
fi
tour 3c-jobs-scrolled-up 'scrolled back up: the bar whole again, names and all' "$flows/expo-go-scroll-up.yaml"
if [ "$(bar_names 3c-jobs-scrolled-up)" != 4 ]; then
  failed+=("3c-jobs-scrolled-up: the tab bar's names did not come back")
  echo "::error title=Expo Go: 3c-jobs-scrolled-up::not all four of the tab bar's names are read after scrolling back up"
fi
# A tour of what was added lately, one step at a time and each read back:
# the order's menu, the filter sheet, a listing and its Share, back, a card
# held for its menu, a company. Expo Go must still be on the app at the end of it.
glance t0-board 'tour: the board, before'
last_shot=t0-board
tap_word t1-sort-menu 'tour: the order' 'الأحدث'
tap_word t2-sorted 'tour: by salary' 'الأعلى راتباً'
tap_word t3-filters 'tour: the filter sheet' 'الفلاتر'
# Closed with its own button, not its X: Expo Go's floating tools button sits
# over the sheet's top corner, and a tap there opened Expo Go's menu instead.
tap_word t4-filters-closed 'tour: the sheet closed' 'شوف النتائج' '50%,92%'
tap_word t5-listing 'tour: the first listing' 'عمولة فقط' '50%,45%'
tap_word t6-share 'tour: Share' 'مشاركة'
tap_word t7-share-cancelled 'tour: Share cancelled' 'إلغاء'
# Back, at the start of the line: the right in Arabic, under the status bar.
tour t8-back 'tour: back to the board' -e 'POINT=91%,9%' "$flows/expo-go-tap.yaml"
# A card held: its menu at the foot of the screen, then closed from the shade above it.
tour t8b-card-held 'tour: a card held' -e 'POINT=50%,45%' "$flows/expo-go-hold.yaml"
if ! grep -q 'افتح الإعلان' "$out/t8b-card-held.boxes"; then
  failed+=("t8b-card-held: no menu on a held card")
  echo "::error title=Expo Go: t8b-card-held::holding a job card did not show its menu (افتح الإعلان not read)"
fi
tour t8c-menu-closed 'tour: the menu closed' -e 'POINT=50%,12%' "$flows/expo-go-tap.yaml"
tap_word t9-companies 'tour: the Companies tab' 'الشركات'
tap_word t10-company 'tour: a company' 'الصفوة' '50%,40%'
tour t11-company-back 'tour: back to the companies' -e 'POINT=91%,9%' "$flows/expo-go-tap.yaml"
if grep -qE '^y[0-9]+ x[0-9-]+  (Playground|Welcome to your playground\.|Projects|Recently opened)$' "$out/t11-company-back.boxes"; then
  failed+=("tour: the app was left for Expo Go's own screens")
  echo "::error title=Expo Go: tour::the app was left during the tour (Expo Go's own screen showed): see the t1–t11 readings in the log"
fi
open_app jobs
see 3f-jobs-after-tour 'الفلاتر'

open_app companies
see 3d-companies 'الموثّقة بس'
in_header 3d-companies 'شركات العقارات'
open_app account
see 4-account 'ادخل على حسابك'
in_header 4-account 'حسابي'
open_app sign-in
see 5-sign-in 'أهلاً بيك تاني'

# Back to Expo Go's own home, and the app opened again from there: the other case.
xcrun simctl terminate "$udid" host.exp.Exponent > /dev/null 2>&1 || true
xcrun simctl launch "$udid" host.exp.Exponent > /dev/null
sleep 8
xcrun simctl io "$udid" screenshot "$out/6-expo-go-home.png" > /dev/null 2>&1 || true
open_app
see 7-welcome-again 'إنشاء حساب'
skip
see 8-home-again 'منصة متخصصة لوظائف العقارات في مصر' 'الرئيسية'

for verdict in "$out"/*.verdict; do
  if grep -q 'LEFT TO RIGHT' "$verdict"; then
    failed+=("$(basename "$verdict" .verdict): tab bar left to right")
  fi
done

# What Expo Go said went wrong while it ran: the app's own JavaScript errors
# (React Native logs them as errors, and a fatal one as RCTFatal), and any
# crash report iOS wrote for it.
xcrun simctl spawn "$udid" log show --style compact --start "$started" \
  --predicate 'process == "Expo Go" AND (messageType == error OR messageType == fault OR subsystem == "com.facebook.react.log" OR eventMessage CONTAINS "RCTFatal" OR eventMessage CONTAINS[c] "unhandled")' \
  > "$out/expo-go-errors.log" 2> /dev/null || true
if [ -s "$out/expo-go-errors.log" ]; then
  echo "::group::Expo Go's errors ($(wc -l < "$out/expo-go-errors.log") lines; the last 300)"
  tail -n 300 "$out/expo-go-errors.log"
  echo "::endgroup::"
  python3 -c '
import sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()[-3800:]
print("::warning title=Expo Go: errors logged::" + text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
' "$out/expo-go-errors.log"
fi
for report in "$HOME"/Library/Logs/DiagnosticReports/*Expo*; do
  [ -f "$report" ] || continue
  [ "$report" -nt "$work/boot.log" ] || continue
  cp "$report" "$out/"
  failed+=("Expo Go crashed: $(basename "$report")")
  python3 -c '
import sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()[:3800]
print("::error title=Expo Go crashed::" + text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
' "$report"
done

xcrun simctl shutdown "$udid" > /dev/null 2>&1 || true
xcrun simctl delete "$udid" > /dev/null 2>&1 || true

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::Expo Go: ${failed[*]}"
  exit 1
fi
echo "Expo Go: every screen opened, right to left"
