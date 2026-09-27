# Cross-browser and real-device QA (work 16)

Status as tested on **2026-09-27/28**, branch `qa16-cross-browser`, rebased
onto `main` at 9b60c83 and re-verified there. Functional and responsive only —
nothing was redesigned. Every finding below was reproduced before it was fixed
and re-checked after, in the engines named.

## How it was tested

| | |
|---|---|
| **Chrome / Edge / Android Chrome** | Chromium 153 (Playwright). Phones emulated with touch, an Android user agent and DPR 2.625; tablets with touch. Edge is not installed on the test machine and shares the engine. |
| **Safari / iOS Safari** | WebKit 26.6 (Playwright), phones as iPhone (touch, iOS user agent, DPR 3), tablets as iPad. Plus **real Mobile Safari on the iOS 27 simulator** (iPhone 17) for rendering. |
| **Firefox** | The installed release, **Firefox 147**, driven over WebDriver BiDi. Playwright's own Firefox build cannot start under this machine's process sandbox; the real one can when launched through LaunchServices. |
| **Widths** | 320, 360, 375, 390, 412, 430, 480, 768, 820, 1024, 1280, 1366, 1440, 1536, 1920 — each with a realistic height. |
| **Per page load** | horizontal overflow (document `scrollWidth` against `clientWidth`, then the element that sticks out, ignoring content inside a scroller or a clipping box); whether IBM Plex Sans Arabic actually loaded (`document.fonts.check`); console and page errors. |
| **Server** | a local production build (`next start`) of this branch against the live database, with `SUPABASE_SERVICE_ROLE_KEY` and the Resend keys blank so no email could be queued. Signed-in pages through the local demo accounts. In every mutation test the write was refused before it left the browser. |
| **Volume** | public pages 24 × 15 widths × 3 engines = 1,080 loads; candidate console and signed-in public pages 10 × 15 × 3 = 450; employer console 11 × 15 × 3 = 495. |
| **After the rebase** | re-checked on a fresh build of the rebased branch in Chromium and WebKit: the header signed out, as a candidate and as an employer at 320–768px on `/`, `/jobs` and `/agents`; dropped saves on the profile and company forms; the password reset offline; Arabic digits, CV types, the photo retry and share; Safari's applicant pages. |

## Matrix

PASS — works as intended. FIXED — was broken, fixed on this branch and
re-verified. KNOWN LIMITATION — not fixed or not testable here, with why.

| Area | Chrome | Safari (WebKit) | Firefox | iOS Safari | Android Chrome | Edge |
|---|---|---|---|---|---|---|
| No horizontal overflow, signed out, 15 widths | PASS | PASS | PASS | PASS¹ | PASS² | PASS³ |
| No horizontal overflow, signed in (site header) | FIXED | FIXED | FIXED | FIXED¹ | FIXED² | FIXED³ |
| No horizontal overflow, candidate & employer consoles | PASS | PASS | PASS | — | PASS² | PASS³ |
| Arabic font, RTL, mixed Arabic/Latin, Western digits | PASS | PASS | PASS | PASS | PASS² | PASS³ |
| Dates: the server and the browser print the same text | FIXED⁸ | FIXED | FIXED⁸ | FIXED⁶ | FIXED⁸ | FIXED⁸ |
| `100vh`/`dvh`, sticky header and rails, fixed apply bar | PASS | PASS | PASS | PASS⁴ | PASS² | PASS³ |
| Dialogs, filter sheet, phone menu, notifications panel | PASS | PASS | PASS⁶ | — | PASS² | PASS³ |
| Mobile keyboards: phone, email, whole numbers | FIXED | FIXED | FIXED | FIXED⁵ | FIXED⁵ | FIXED |
| Arabic-Indic digits typed into money fields | FIXED | FIXED | FIXED⁶ | FIXED⁵ | FIXED⁵ | FIXED³ |
| File uploads: CV, photo, logo, documents | FIXED | FIXED | FIXED⁶ | KNOWN LIMITATION⁷ | FIXED² | FIXED³ |
| A save whose connection drops (interrupted mutation) | FIXED | FIXED | FIXED | FIXED⁶ | FIXED² | FIXED³ |
| A save on a slow connection (pending state, double tap) | PASS | PASS | PASS⁶ | — | PASS² | PASS³ |
| Back button: filters and search survive | PASS | PASS | PASS⁶ | — | PASS² | PASS³ |
| Back button: scroll position restored | PASS | PASS | PASS | — | PASS² | PASS³ |
| Share a listing | FIXED | FIXED | FIXED⁶ | FIXED⁶ | FIXED⁶ | FIXED³ |
| WhatsApp links | PASS | PASS | PASS | PASS⁶ | PASS⁶ | PASS³ |
| Sign-up, sign-in, password reset, onboarding screens | PASS | PASS | PASS | PASS | PASS² | PASS³ |

1. iOS 27 Safari on the simulator, pages as loaded. Gestures could not be
   injected in this environment (every tap and swipe timed out), so nothing
   below the first screen was scrolled to on the device itself.
2. Emulated in Chromium: Android user agent, touch, phone DPR. No Android
   device or emulator is available.
3. Edge is Chromium; not installed on the test machine.
4. The fixed apply bar sits clear of Safari's floating toolbar as loaded. The
   collapsed-toolbar state needs a scroll gesture and was not exercised.
5. The fix is the attribute or the input handling; the on-screen keyboard
   itself was not driven.
6. Same code path as the engines tested directly (JavaScript that does not
   branch by browser); not exercised in that engine separately.
7. Camera and photo-library pickers cannot be driven on the simulator. The
   accept lists are unchanged — images for photos and logos, PDF/Word for CVs —
   so iOS still offers Photo Library, Take Photo and Choose File.
8. Chromium and Firefox print Arabic dates exactly as Node does; what they
   shared with Safari is the time-zone half — within about three hours of
   midnight the server (UTC) and a browser in Egypt named different days.
   Fixed by construction; that window was not hit during a run.

## What was fixed

**Signed in, every public page scrolled sideways on a phone.** The phone
header is three cells with the mark centred; the end cell was sized
`minmax(0, 1fr)`, which only worked while it held one button. Signed in it
holds three — the bell, the account and the menu, 144px — and on a 375px
screen they spilled 22px off the page (50px at 320), on `/`, `/jobs`, the
apply page, the directory and the rest, in all three engines. The outer cells
are now `minmax(max-content, 1fr)`: equal and centred wherever that fits, off
centre by the difference where it does not. Below 360px a signed-in reader's
wordmark becomes screen-reader-only so the row fits; visitors keep it at every
width. `src/components/site-header.tsx`, `src/components/logo.tsx`.

**A dropped connection during any save threw the form away.** A server action
is a fetch; when it fails, the promise rejects, and every caller awaited it
inside `startTransition`, where React 19 hands the error to the nearest error
boundary. The boundary replaced the page with the "something went wrong"
panel, and Retry rendered the form again empty — a profile, a job post several
steps in, an application with its CV attached. `reach()` turns the rejection
into the `{ ok: false }` result every caller already shows inline ("مقدرناش
نكمّل العملية. جرّب تاني."), so the form and what was typed stay. Applied at
every server-action call in the app (49 call sites in 33 components). The
sign-in form's call for friction advice catches instead, as the new-password
form already did. The forgot-password form answers every server-side failure
with "check your inbox" so that it cannot be used to test addresses; a request
that never left the phone tests nothing, so that one case now says try again
rather than sending somebody to wait for an email nobody sent. Verified in
Chromium, WebKit and Firefox; on a slow line the button stays locked while the
request is pending and a second tap sends nothing. `src/lib/reach.ts`.

**Uploads trusted the browser's guess at a file's type.** `File.type` comes
from the operating system: a Windows machine without Office has no type for
`.docx`, and some Android file providers answer `""` or
`application/octet-stream`. Every uploader compared `file.type` with its list,
so a perfectly good CV was refused as the wrong kind of file — and the bucket
would have refused it again on the content type. The extension now decides when
the browser does not, the storage suffix comes from the type rather than from
whatever the device called the file, and the buckets still enforce their lists.
`src/lib/file-type.ts`, used by the apply form, the consultant profile and the
verification documents, and by the photo and logo pickers' own pre-check
(those two now send their bytes to the server, which sniffs them; the
browser's pre-check was still refusing first).

**After a failed upload, picking the same file again did nothing.** A file
input only reports a change, and the photo, logo and document pickers kept the
failed file selected — so the obvious retry was silently ignored. They are
emptied as soon as the file is read.

**Arabic-Indic digits typed into money fields vanished.** The grouped number
field (salaries, units closed, sales volume) kept only `\D`-free characters,
and `\D` is ASCII-only: `٤٥٠٠٠٠٠` from an Arabic keypad was stripped to nothing,
so the field refused every keystroke. It now reads `4,500,000` and submits
`4500000`. The phone normaliser accepts the Extended Arabic-Indic digits
(`۰–۹`) as well as `٠–٩`.

**Safari dated things differently from the server.** `formatDate` took
Intl's Arabic pattern whole, and Safari's ICU writes it with a comma after the
month — `14 أغسطس، 2026` — where Node, Chrome and Firefox write
`14 أغسطس 2026`. A client component formats once on the server and again in
the browser, so on Safari, and every iPhone, React threw hydration error 418,
discarded the server's HTML and rebuilt the tree — on every load of the
employer's applicant list and of each job's applicants. The date is now
assembled from its parts, which agree in every engine (measured, all twelve
months, identical in Node, Chromium, WebKit and Firefox), and both date
formatters read Cairo's calendar, as the relative-day one already did.
`src/lib/utils.ts`.

**Share.** Dismissing the share sheet fell through to copying the link — onto
the clipboard of somebody who had just said no, and on iOS the copy failed
anyway because the tap was spent. A dismissal now does nothing. Where there is
no share sheet (Firefox on a desktop, for one) the link is copied and the button said
"تم الحفظ" (saved); it now says "اتنسخ الرابط".

**Keyboards.** Whole-number fields — seats, years of experience, graduation
year — get `inputMode="numeric"`, the digit pad, instead of iOS's punctuation
keyboard. The percentage field is deliberately left alone: a decimal pad types
the locale's separator, and the Arabic one is rejected by a number input. The
consultant profile's name and WhatsApp fields gain the same `autoComplete` the
apply form already had.

Found during this round and fixed on `main` by PR #12 while it ran: the
footer's two doors made every public page 86px wider than a 375px phone for
signed-out visitors.

## Checked and left alone

- **Filters are the URL.** Every filter and the search box write the query
  string, so Back returns with them intact; the active-filter chips are links.
- **Scroll after Back is restored** by the browser in all three engines,
  measured against the live site. (An early measurement said otherwise; the
  test harness had scrolled the link into view before clicking it.)
- **Number inputs render Western digits** on `lang="ar"` pages in all three
  engines.
- **Fonts.** IBM Plex Sans Arabic loaded on every one of the 2,025 loads.
- **WhatsApp** is `wa.me` with the opener pre-filled, in a new tab. There are
  no `tel:` links in the product; `mailto:` appears only when a support address
  is configured.
- **The filter sheet** is sized in `dvh` and padded for the home indicator; the
  sticky filter rails cap at `100dvh`.

## Known limitations

- **Edge** is not installed; Chromium stands in for it.
- **Android Chrome** is emulated, not run on a device.
- **Desktop Safari** is the WebKit engine build, not Safari.app, which needs
  "Allow Remote Automation" switched on by the machine's owner.
- **iOS gestures** could not be injected on the simulator here, so the
  collapsed toolbar, the on-screen keyboard over fixed bars, pinch zoom and the
  camera and photo pickers were not exercised on the device.
- **Browser baseline.** Tailwind CSS v4 targets Safari 16.4+, Chrome 111+ and
  Firefox 128+. Older browsers — an iPhone stuck on iOS 15, an old Android
  WebView inside another app — get degraded styling: translucent tints built
  with `color-mix()` and shadows built on `@property` drop out.
- **`pnpm check` is red on `main` itself**, not on this branch: two migrations
  share version 068 (`search_that_reads_the_listing_the_way_people_do` and
  `what_the_provider_said_happened`), and the schema suite refuses that. This
  branch touches nothing under `supabase/`. Every other suite passes here.
- **Hydration error #418, the intermittent kind.** Apart from the Safari
  dates (a text mismatch, fixed above), an element-level #418 turned up now
  and then against the local `next start` build, in all three engines and on
  pages with no client-side dates. It never appeared on the dev server (0 of
  54 loads) or on www.brokersconnect.net (0 of 36), and it predates this
  branch, so it is treated as an artefact of the local production server —
  worth one look in Vercel's logs if it ever shows up there.

## Re-running it

The harness lives outside the repository (it drives installed browsers and
needs a signed-in demo session), so this is the recipe rather than a script:
build (`pnpm build`), start with the service-role and Resend keys blank, sign
in through the local demo buttons, then for each engine and width load each
page, wait for `document.fonts.ready`, and compare
`document.documentElement.scrollWidth` with `clientWidth`. Anything that writes
must be refused in the browser — a route that aborts `POST`s carrying a
`next-action` header, and any non-`GET` to `supabase.co`.
