# The page for the app: `/app`

What `/app` is for, what is on it and why, and how it moves. The page is
`src/components/get-app/get-app-landing.tsx` and the pieces beside it; the
copy is `appPage` in `messages/*.json`. This is the plan it was built to,
kept so the next change can be measured against it.

## The job

One visitor, one action: somebody on a phone, usually arriving from a
WhatsApp link or the site's footer, decides to install the app. Everything
on the page either makes that decision easier or gets out of the way. There
is no second call to action, no newsletter, no "learn more".

The page has to be true. Every claim on it is one the store listing makes
(`mobile/store.config.js`) and the code backs: pay in figures, the lead
source on every listing, one-tap applications, a notification when an
application moves, the directory profile the consultant controls. Nothing
counts users, downloads or ratings, because nothing measures them yet.

## What is on the screen

The pictures are the app itself: captures from the `iOS screens` workflow
(`.github/workflows/ios-screens.yml`), which builds the App Store build and
photographs it on an iPhone simulator in Arabic against the live site — the
largest iPhone in the light appearance (the store set), the same in the dark
appearance, and at the largest accessibility text size. They live in
`public/app-screenshots/`:

| File | Pass | Screen |
| --- | --- | --- |
| `welcome.webp`, `home.webp`, `jobs.webp`, `listing.webp`, `companies.webp`, `company.webp` | store (light) | the welcome, Home, the board, a listing, the companies, a company |
| `dark/home.webp` … | dark | the same screens in the dark appearance |
| `large-text/home.webp` … | large-text | the same at the largest text size |

The run's captures are 1320×2868 PNGs; here they are 1179 wide and WebP
(`sharp`, quality 90), which is a tenth of the bytes and more than the
frames ever draw. They show whatever production listed when the run was
made (the set here is run 35, 2026-10-07, with the demo listings live), so
they are refreshed by running the workflow again, then "iOS screens to a
branch" (`screens-to-branch.yml`) with its run id, which brings the artifact
somewhere git can reach; then, from a checkout of that branch:

```bash
node -e '
const sharp = require("sharp");
const names = { "0-welcome": "welcome", "1-home": "home", "2-jobs": "jobs", "3-listing": "listing", "4-companies": "companies", "5-company": "company" };
const passes = { store: "", dark: "dark/", "large-text": "large-text/" };
for (const [pass, dir] of Object.entries(passes)) for (const [from, to] of Object.entries(names)) {
  if (pass !== "store" && from === "0-welcome") continue;
  sharp(`screens/${pass}/${from}.png`).resize({ width: 1179 }).webp({ quality: 90, effort: 6 }).toFile(`public/app-screenshots/${dir}${to}.webp`);
}'
```

`docs/app-store.md` has the detail of the run itself. The social card,
`public/brand/og-app.jpg`, is drawn from the Home capture by
`scripts/og-app-card.mjs` and is re-drawn with it.

## The page, top to bottom

1. **Hero.** The landing pages' dark ground, without the film, with a slow
   aurora drifting behind it. At the start: an eyebrow naming what the app
   is (iPhone, Arabic, free for candidates), the headline «بروكرز كونكت،
   دلوقتي في جيبك», one sentence on what it does, the two store badges, and
   the line that it costs a candidate nothing. At the end: the phone, held
   up, showing the app's Home — and then, every few seconds, the board and a
   listing, cross-fading, with three dots saying which. The header floats
   over it as it does on `/employers`.

2. **Walkthrough.** The centre of the page: the five screens, each with a
   sentence on what the reader does there. From `lg` the phone sticks to the
   side while the five steps scroll past it, and the screen changes to the
   step in view; tapping a step does the same. Below `lg` it is one row of
   phones that snaps as it scrolls, with the step under each, arrows at the
   ends and dots that say where the reader is.

3. **Features.** Four cards, each a thing the app does for a consultant that
   the screens above showed: pay in figures, apply in a minute, follow every
   application, the profile is theirs to show or hide. An icon, a title, two
   lines. They arrive as the reader reaches them.

4. **Appearance.** "On your phone, your way": one phone and a three-way
   switch — light, dark, large text — that cross-fades between the real
   captures of the same screen. It is the one section with a control in it,
   because it is the one claim best proved by letting the reader try it.

5. **The ask, again.** A band with the headline's answer and the two badges,
   closing the page the way `/employers` closes.

## How it moves

Motion here is of two kinds, and both respect `prefers-reduced-motion`
(`motion-safe:` on every utility, and the keyframes are not started at all
under the media query).

- **Things that change while you watch.** The hero's screen cross-fading
  (400 ms, opacity and a 2% scale), the walkthrough's screen following the
  step, the appearance switch, a carousel moving on an arrow press (smooth
  scroll to the snap point), the badges on hover (2% larger, brighter) and
  on press (2% smaller). This is the kind of motion the rest of the site
  already allows itself.
- **Things that arrive.** Section headings and the feature cards fade up
  12 px as they enter the viewport, once, 400 ms, the cards 60 ms apart. The
  site's other pages do not do this (globals.css says why); this page is a
  product page for a phone app, where a little arrival is the convention,
  and it is kept to the two places where it says "there is more below".
- **Ambient.** The hero's aurora (two blobs, transform only, a 24 s loop) and
  the hero phone floating 6 px over 6 s. On a pointer device the hero phone
  tilts a few degrees toward the cursor; on a touch device it does not move
  with the finger. The hero's cross-fade pauses while the pointer is over
  the phone, while anything in it has focus, and while the tab is hidden.

No scroll-linked parallax, no counters, no typewriters, no particles.

## Shape, by width

- **Phone (to `sm`).** One column: hero text, badges, then the phone cropped
  at the band's edge. The walkthrough is the carousel, one phone and a half
  in view. Features one to a row, then two from `sm`. The appearance phone
  is centred under its switch.
- **Tablet (`sm`–`lg`).** The hero stays one column with the phone centred;
  the carousel shows two and a half phones; features two to a row.
- **Desktop (`lg` up).** The hero is two columns, phone at the end (right in
  English, left in Arabic). The walkthrough is the sticky phone beside the
  steps. Features four to a row. The appearance section is the switch and
  phone side by side.

Everything is logical (`start`/`end`, `ms`/`me`), so Arabic mirrors the
layout and the drawn phone's buttons stay on their physical sides.

## Words

Short, concrete, in the register the rest of the site uses (Egyptian
colloquial in Arabic). Each section says one thing. Nothing is "seamless",
"powerful", "effortless" or "designed for you"; no sentence exists to fill a
grid cell. The captions under the screens are the app's own tab and screen
names, so a reader who installs it meets the same words.

## Access

Headings in order, one `h1`. Every capture has an alt that names the screen
it shows. The walkthrough's steps are buttons with `aria-current` on the one
in view; the carousel's arrows and dots are buttons with names; the
appearance switch is a group of radio buttons. The hero's rotating screen
announces nothing (it is decoration over a labelled image). The Google Play
badge is `aria-disabled`, out of the tab order, and says "coming soon" in
its name. Focus rings are white on the dark hero and brand blue elsewhere.

## Weight

No new dependency: the motion is CSS and three small client components
(the hero phone, the walkthrough, the appearance switch). The page's
first-load JavaScript stays inside the public-page budget in
`perf-budget.json` (155 kB; it was 112 kB before the interaction was
added). Every capture goes through `next/image` with `sizes` set to what the
frame is actually given, the hero's preloaded and the rest lazy; the
cross-fading stacks keep only their current image in the DOM's painted set.

## Still to do, outside this page

- The store links. Both badges point at `#` until the listing exists
  (`docs/app-store.md`); then the App Store badge takes `MOBILE_APP_STORE_URL`
  and the Google Play one wakes up with `MOBILE_PLAY_STORE_URL`.
- Signed-in screens. The captures are a signed-out run, so the applications,
  saved and profile tabs are described, not shown. A capture pass signed in
  as the review candidate would add them.
