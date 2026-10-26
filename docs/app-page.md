# The page for the app: `/app`

What `/app` is for, what is on it and why, and how it moves. The page is
`src/components/get-app/get-app-landing.tsx` and the pieces beside it; the
copy is `appPage` in `messages/*.json`; the store links are
`src/lib/app-links.ts`. This is the plan it was built to, kept so the next
change can be measured against it.

## The job

One visitor, one action: somebody on a phone, usually arriving from a
WhatsApp link or the site's footer, decides to install the app. The store
buttons open the page and close it; everything between is the app itself.

The page has to be true. Every claim on it is one the store listing makes
(`mobile/store.config.js`) and the code backs: pay in figures, the lead
source on every listing, one-tap applications, a notification when an
application moves, the verified badge, the follow button, the directory
profile the consultant controls, light and dark and the phone's text size.
The pay claim is worded as the site words it everywhere else: the lead
source is on every listing; the salary and commission are asked of every
company and shown in figures when the company publishes them. Nothing
counts users, downloads, jobs or companies; nothing is rated,
quoted or endorsed, because nothing measures those yet. A fact the page
wants and does not have is a `TODO` in the code, never a guess.

## What is on the screen

The pictures are the app: captures from the `iOS screens` workflow
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

What the captures do not show is drawn in HTML and says so by looking like
a sketch: the notifications (the run is signed out and sees none), the
filters as chips, the follow button, and a profile with a blank avatar,
"your name" and empty fields.

Wherever the app already has words for something, the page uses them
rather than paraphrasing: the notification cards are built from the same
catalogue keys the bell and the push use (`notifications.*`, with a sample
job title and saved search), the follow button and the line under it are
the company page's (`companies.follow*`), the three visibility choices and
their explanations are the onboarding form's (`visibility.*`), and the
filters are the board's own tracks, lead sources and sort orders.

## The page, top to bottom

1. **Hero.** A pill naming what it is (iPhone, Arabic), the headline, one
   sentence, the two store buttons, the line that it costs a candidate
   nothing. Three phones fanned: Home in front, floating, the board and a
   listing behind it. A soft dot grid and a glow, nothing busier.
2. **Four highlights**, one row: who supplies the leads, pay in figures
   (when the company publishes it), applying in one tap, updates on an
   application.
3. **The terms before applying** (dark). The listing's capture with three
   chips pointing at the three facts on it, and two small cards: the
   phrases many listings use, struck through, beside this board's.
4. **Finding the right job.** The board's capture beside the filters as
   chips to try: the six tracks, eight areas, the three lead sources, the
   two sort orders — the board's own words.
5. **Applying** (tinted). Three steps that light up one after another,
   ending on "sent".
6. **Notifications** (dark). Four cards sliding in over a blurred Home:
   the application arrived, moved to the shortlist, moved to an interview,
   a new job in a saved search — the real templates.
7. **Companies.** The companies and a company's page side by side, three
   points, and the follow button to press, with the line the app shows
   under it.
8. **The profile** (tinted). A profile with nothing real on it under the
   three choices the product offers: every approved company, verified
   companies only (the name blurs, as an unverified company sees it), or
   hidden.
9. **The tour.** From `lg`, one phone and five tabs; the screen follows the
   tab, and the tour advances on its own until touched. Below `lg`, a
   row that snaps, dots and arrows.
10. **Three steps to start.**
11. **The two doors**: looking for work, hiring.
12. **Questions**, one open at a time, with `FAQPage` data for search.
13. **The ask, again** (dark), with a phone leaning in from the edge.

On a phone, once the hero has scrolled away, a small floating bar near the
foot of the screen carries the mark, the name and a "get the app" button to
the App Store; it leaves while the closing band is on screen. The site header
scrolls away on this page instead of sticking, so the two never share the
screen.

(An appearance section — light, dark, large text — was here and was taken
out on the owner's request; the dark and large-text captures stay in
`public/app-screenshots/` for the store and for later.)

## How it moves

Every piece respects `prefers-reduced-motion` (`motion-safe:` on each
utility; the observers that time sequences skip straight to the end).

- **Things that arrive.** Headings and cards fade up 16px as they enter the
  viewport, once (`reveal.tsx`, which never hides what is on screen at the
  first paint and hides nothing without JavaScript). Rows arrive 80ms
  apart.
- **Things that change while you watch.** The tour's cross-fade (300ms),
  the visibility choice, the carousel moving on an arrow, chips and the
  follow button on press, the store buttons on hover and press, the FAQ
  opening by growing its grid row.
- **Sequences.** The callout chips, the three apply steps and the four
  notification cards run once, when their section is in view.
- **Ambient.** The hero's front phone floats 6px over 6s; the dark sections'
  glows drift on long loops, transform only.

No scroll-linked parallax, no counters, no typewriters, no particles.

## Shape, by width

Logical properties throughout, so Arabic mirrors the layout; the drawn
phone's buttons stay on their physical sides. Below `lg` the page is one
column and its text is centred — headings, paragraphs, buttons, the
highlight cards, the filter chips, the steps — with the words before the
pictures. Desktop (`lg` up): two columns, text at the start of its column,
the phone changing sides from one feature to the next, the highlights four
across, the tour as tabs beside a phone. No horizontal scroll at 360px, and
no phone in the hero is cut by the edge of the screen.

## Words

Short, concrete, in the register the rest of the site uses (Egyptian
colloquial in Arabic); each section says one thing. Captions are the app's
own screen names, so a reader who installs it meets the same words.

## Access

One `h1`, headings in order. Every capture that carries meaning has an alt
naming the screen; a capture repeating one described nearby is decorative.
The tour is the tabs pattern; the chips, dots and the follow button say
their state with `aria-pressed`; the visibility choice is a radio group; the FAQ's
closed answers are `inert`. The Google Play badge is `aria-disabled`, out
of the tab order, and says "coming soon" in its name. Focus rings are the
brand blue, white on the dark sections.

## Weight

No new dependency. The route's first-load JavaScript stays inside the
public-page budget in `perf-budget.json`. Every capture goes through
`next/image` with `sizes`; the hero's front phone is preloaded, the rest
lazy.

## Analytics

Three events (`src/lib/analytics.ts`), no-ops until a provider is set:
`app_store_click` with `location` (hero, sticky, final), `app_tour_tab`,
`app_faq_open`.

## Still to do, outside this page

- The store links in `src/lib/app-links.ts`: `APP_STORE_URL` once the
  listing exists, `GOOGLE_PLAY_URL` when Android ships (the badge wakes up
  on its own).
- Signed-in captures: the run is signed out, so the applications, saved
  and profile tabs are described, not shown. A capture pass signed in as
  the review candidate would add them, and a real notifications screen
  would replace the drawn cards.
