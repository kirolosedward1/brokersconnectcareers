# Device compatibility and accessibility (work 11)

Status on **2026-10-22**, `main` at 90d70f9 plus this branch. The website's
full three-engine pass is `docs/cross-browser-qa.md` (September); this round
is mostly about the app, with the website re-checked where it could be.

**Read this first: no physical device, iOS Simulator or Android emulator was
available.** The work ran on a Linux container. Xcode, the iOS Simulator and
Maestro need macOS. KVM for an Android emulator is not available. Production
(`www.brokersconnect.net`) is blocked by the machine's network policy. So
every "tested" below names exactly what ran, and the device rows that only CI
or a person can fill are marked so.

## What the app supports

| | |
| --- | --- |
| iOS | **16.4 and later** (Expo SDK 57's floor, `ios.deployment_target` in its podspecs), iPhone only (`supportsTablet: false`). iPads open it in iPhone compatibility mode, which App Review also uses. iOS 26 adds Liquid Glass bars and the tab bar that shrinks on scroll (`src/lib/liquid-glass.ts`), with the plain bars below 26 |
| Screen sizes | 375 pt wide (iPhone SE 2nd/3rd gen, 375 × 667; the 12/13 mini, 375 × 812) up to 440 pt (the Pro Max / Plus phones, 440 × 956). Nothing narrower runs iOS 16.4 |
| Orientation | Portrait only (`orientation: 'portrait'`) |
| Android | Not shipped yet. When it is: Android 7.0 (API 24) and later, `targetSdk` 36 |
| Text size | Every size iOS offers, up to the largest accessibility size (font scale 3.571). At ≥ 1.4 (`src/theme/large-text.ts`) the app's own rule applies: side-by-side things stack, no line is cut short |
| Appearance | Light, dark, or the phone's setting (Account) |
| Motion | Reduce Motion honoured (fades only, `src/theme/reduce-motion.ts`) |
| Language | Arabic, right to left, forced while `ENGLISH_ENABLED` is off |

## What was actually tested

### The app

| Check | How | Result |
| --- | --- | --- |
| The app's whole suite (`pnpm check`): typecheck, lint, shared-code guard, update-publishing check, licences, Jest | Node 22, jest-expo 57.0.5, React Native 0.86.3 test renderer | 46 suites, 841 tests. All pass, except one timing-dependent sign-in test that timed out once under full load and passes on its own (82/82). That test is untouched by this branch |
| Text cut short at the accessibility sizes | A static audit of every `numberOfLines` in `src/` | **37 places fixed** (17, then 20 more that arrived from `main` while this was open), plus the select field. Now a test, `tests/large-text.test.tsx` |
| The welcome screen on small phones at large text | Line wrapping measured with the app's own font (IBM Plex Sans Arabic via HarfBuzz/raqm), the welcome's real strings and its type scale, at 375 × 667, 375 × 812 and 440 × 956, font scales 1–3.571 | **Fixed**: see below |
| VoiceOver/TalkBack labels | Static audit of every `Pressable`, `PressableScale`, `Switch`, `TextInput`, `TextField` and `Image` | Every control has a role; all 50 text fields carry their label; errors are announced (`useErrorsInView`). Nothing to fix |
| Safe areas and pinned bars | Audit of every view pinned with `insets.bottom` or `position: 'absolute'` | The filter sheet's footer is one button and fits; the welcome's footer did not (fixed) |
| Keyboard | Read: `KeyboardRoom`, return key moves field to field, the six-digit code submits itself | Covered by existing tests; no change |
| Android permissions and target | Every Expo module's `AndroidManifest.xml`, React Native's `libs.versions.toml` | `docs/app-store.md`, "Google Play" |

**Not tested here, needing a device or CI:** how anything looks on a real
screen; VoiceOver and TalkBack reading order on the device; Dynamic Type
re-flow while the app is open; the on-screen keyboard over fields; iOS
16/17/18 (only reasoned about from the code's branches: the app's own iOS-26
switch and SwiftUI-backed `@expo/ui`); Android at all.

The repository already has the tool for most of that:
`.github/workflows/ios-screens.yml` runs the app on iOS simulators in light,
dark, the largest text size and on an iPad. **It covers only the largest
iPhone.** Adding an iPhone SE (3rd generation) at the largest accessibility
size is what would have caught the welcome screen; that needs a macOS runner
and is the first thing to add (`mobile/scripts/store-screens.sh`, a fifth
pass next to `large-text`).

### The website

A local production build (`next build` / `next start` of this branch) in
**Chromium 141** (Playwright). Phones at 320–480 px with touch, an iPhone user
agent and DPR 3; tablets with touch; desktops without. No database: the
build ran with placeholder Supabase keys, since production and a local
Supabase were both out of reach, so the board, the companies list and Home
drew their empty or unavailable states, not real listing cards.

| | |
| --- | --- |
| Pages | `/`, `/jobs`, `/companies`, `/employers`, `/blog`, `/privacy`, `/terms`, `/cookies`, `/refunds`, `/account-deletion`, `/licenses`, `/sign-in`, `/sign-up`, `/sign-in/forgot`, and a 404 |
| Widths | 320, 360, 375, 390, 412, 430, 480, 768, 820, 1024, 1280, 1366, 1440, 1536, 1920 — 225 loads |
| Horizontal overflow | **none** (document `scrollWidth` against `clientWidth`) |
| Arabic font loaded | 225 of 225; every page `dir="rtl"`, `lang="ar"` |
| Page errors | none |
| axe-core 4.10 (WCAG 2.0/2.1 A and AA) | at 390 and 1280 px, 30 loads: **0 violations**. axe was checked against a page with four planted violations, and found all four |

Not repeated this round: WebKit and Firefox (not installed here; September's
pass covered them), signed-in consoles (no database), and anything real
Safari on an iPhone does differently.

## What was fixed

**Lines cut short at the accessibility text sizes (app).** The app's rule at
font scale 1.4 and above is that no line is cut short. The job card, the
company line and Home's browse list followed it. Seventeen other places
still cut to one or two lines whatever the size: an application's title and
company on the candidate's Home, a company's name in the companies list, a
consultant's name and headline in the directory and the shortlist, a
colleague's name in the team, a listing in the conversion bars, a saved
search, "at <company>" on the board, a picked CV's file name (apply and
profile), onboarding's title and step, the notes toggle, a hidden company's
name, and the chosen value of every select field. At the largest size a name
became one word and "…". Each now wraps at those sizes, as the job card does.
Home's recent applications and Account's "Hidden on this phone" also put
their status badge and button under the text there, rather than squeezing it
to a word a line. `tests/large-text.test.tsx` fails if any `numberOfLines`
is fixed again without a size cap. It listed all seventeen before the fix.

While this was open, `main` added screens (the timeline of an application,
recently viewed, the weekly summary, the compare table, notes, toasts, the
month picker, swipe actions, the quick apply card, the board's count) with
twenty more; the test listed them on the merge (the last two found while
resolving it), and they follow the same rule now. It allows three kinds of fixed line count: text whose size is
capped or never grows (`maxFontSizeMultiplier`, `allowFontScaling={false}`,
as the tab bar's names), a single word that shrinks to fit its cell
(`adjustsFontSizeToFit`, a month in the picker's grid: wrapping would split
an Arabic word), and the share card, a fixed-size picture for a story.

**The welcome screen at the largest text sizes on a small phone (app).** The
welcome pins its ways on (create an account; sign in, with the round Google
and Apple buttons beside it; the company's sign-up) to the foot of the screen
and never scrolls; the words above step down in size to fit what is left.
Nothing limited the ways on themselves. Measured with the real font and
strings, on the welcome as `main` has it now:

| Phone | Text size | Footer height | Room left for the words |
| --- | --- | --- | --- |
| iPhone SE (375 × 667) | default | 176 pt | 425 pt |
| iPhone SE | AX3 (2.643) | 437 pt | 164 pt |
| iPhone SE | AX4 (3.143) | 600 pt | 1 pt |
| iPhone SE | AX5 (3.571) | 779 pt | **−178 pt: the footer is taller than the screen** |
| iPhone 13 mini (375 × 812) | AX5 | 813 pt | **−97 pt** |
| iPhone 17 Pro Max (440 × 956) | AX5 | 599 pt | 249 pt |

So on the two small phones at the largest size the words had no room at all,
and the company's way in was drawn off the bottom of a screen that does not
scroll. The ways on now grow with the text size up to twice the ordinary size
(`WAYS_GROW` in `src/app/welcome.tsx`), as Skip and the headline are already
capped: about 300 pt of footer on every phone, at least 300 pt left for the
words. Twice the ordinary size is still between the second and third
accessibility sizes. (The first version of this fix moved the ways into a
scroll; `main`'s redesign settled that the welcome never scrolls, so the
merge keeps that and caps instead.) CI's large-text pass runs on the Pro Max,
where the footer still fitted, which is why it never showed.
`tests/welcome.test.tsx` checks the cap. The heights are an estimate from
measured line breaks and the app's line heights, not a screenshot: confirm
them on an SE simulator.

## Checked and left alone

- **Fixed caps on purpose**: the brand wordmark (≤ 1.4×), the welcome's Skip
  (≤ 1.4×) and words (≤ 1.3× once stepped down), the bell's badge, the job
  page's title bar, the tab bar's names (no scaling).
  Each is decoration or sits in a bar of fixed height, and the words are said
  in full elsewhere or to VoiceOver.
- **The segmented control** becomes a select at the accessibility sizes, so
  its one-line options never meet large text.
- **Touch targets**: 44 pt minimum (`hitTarget`), small buttons get slop.
- **Contrast**: every text pair 4.5:1, marks and borders 3:1, in both themes
  (`src/theme/tokens.ts`, as documented in `docs/mobile.md`).

## Before the next release (owner)

1. Add an **iPhone SE (3rd generation) pass at the largest accessibility size**
   to `ios-screens.yml` and run it once on this branch.
2. Run the device checklist in `docs/mobile.md` ("On a phone, before a
   release") on one small and one large iPhone, with VoiceOver on for the
   sign-up, apply and delete-account flows.
3. Before Android ships: a TalkBack pass and font scale 2.0 on one device.
