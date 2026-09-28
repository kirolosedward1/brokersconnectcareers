# The iOS app

`mobile/` is the phone version of the website: an Expo (SDK 57) / React Native
app for candidates and employers, on the same Supabase project, built from the
same rules. The admin console stays on the website.

It is being built in phases. This document describes what exists and the
rules that keep the two clients one product.

## How it connects

```
iOS app ──supabase-js (publishable key + the user's JWT, row-level security)──► Supabase
   │                                                    simple per-user reads, RPCs,
   │                                                    file bytes to Storage, Auth
   └──HTTPS, Authorization: Bearer <JWT>──► www.brokersconnect.net/api/mobile/v1/*
            ├─ GET  jobs, companies, browse, landing, …  → the website's own query functions
            └─ POST actions/<name>                       → the website's own server actions
```

**Writes** go through `POST /api/mobile/v1/actions/<name>`, which runs the very
server action the website's form runs, as the signed-in user. The emails, the
upload checks, the slugs, the sanitising and the rate limits therefore happen
for the app exactly as for the site. The actions the app may call are listed in
`src/lib/mobile-api/registry.ts` — nothing else is reachable, and no admin
action is. Their inputs and outputs are typed in `src/lib/mobile-api/contract.ts`,
which the app imports.

Two kinds of write go straight to Supabase, as the website's browser code does:
notification read-state (the `mark_notifications_read` / `open_notification`
RPCs — the logic is in SQL) and file bytes to Storage (CVs, company documents),
whose path is then submitted through the action, which inspects the file and
deletes it if refused.

**Reads** the website builds in TypeScript — the board's search, the company
directory, the browse counts, a listing with its similar roles — come from GET
endpoints that call the same functions (`src/app/api/mobile/v1/*`), so a search
on the phone returns what the same search on the site returns, in the same
order. Their response shapes are `src/lib/mobile-api/reads.ts`; each endpoint
declares it `satisfies` its type, so the website's typecheck fails before the
app receives something it was not promised. Anything else is read directly
under row-level security.

**Status codes.** An action's outcome is always HTTP 200 with the action's own
`{ ok, … }` body — the same result the website's form receives. Anything else
means the request never reached the action: 400 malformed, 401 token refused
(the app refreshes once and retries), 404 unknown action, 413 too large,
415 wrong content type, 503 an auth or database outage (the app keeps the
session and says the service is down).

The security side of this — no cookie is ever a session on a mobile route,
the edge rules, carrier NAT — is in `docs/security/THREAT_MODEL.md` section 6
and `docs/security/EDGE_WAF.md`.

## What the app shares with the website

Imported, not copied, from `src/lib` and `messages/`:

| Module | For |
| --- | --- |
| `job-filters.ts` | The board's filter model: parse, serialise, the active-filter chips. |
| `format.ts` | Numbers, EGP, dates and "3 days ago", in Cairo's calendar with Western digits. |
| `locale.ts` | Which languages exist and which column (`name_ar` / `name_en`) to show. |
| `taxonomy.ts`, `job-state.ts`, `share-source.ts`, `security/sanitize.ts` | Tracks and landing slugs, "is this listing live", the share tag, safe URLs. |
| `mobile-api/contract.ts`, `mobile-api/reads.ts`, `job-list.ts`, `read-types.ts` | The API's types. |
| `messages/{ar,en}.json` | Every word, through `use-intl` — the core of next-intl, the same version. |

`mobile/scripts/check-shared.mjs` walks every import the app can reach and fails
if one would bundle server-only code, Next, next-intl, a server Supabase client,
a Node built-in, anything outside `src/lib` and `messages`, or a package the
app does not itself depend on (an EAS builder installs only the app's). The
web's `scripts/messages.mjs` scans `mobile/` too, so a key only the app uses is
not reported as unused and a key the app asks for must exist.

Changing a shared module changes the app: `.github/workflows/mobile.yml` runs on
`src/lib/**` and `messages/**` as well as `mobile/**`.

## Inside the app

- **Session.** Supabase Auth, as on the website. The session is stored
  encrypted: an AES-256 key generated on the device and kept in the Keychain
  (`expo-secure-store`, this device only, after first unlock), the sealed
  session in app storage. `src/lib/session.tsx` mirrors the website's
  `getViewer()` — the profile row, and for employers the company — and every
  show-or-hide decision comes from `src/lib/permissions.ts`, the website's own.
- **Data.** TanStack Query. Only the taxonomy (districts, governorates,
  developers) is kept across launches, for a day, as the website caches it.
  Lists page twenty at a time and are de-duplicated by id, since offsets shift
  when a listing is published between two loads.
- **Words and direction.** Arabic, right to left, forced while the website's
  `ENGLISH_ENABLED` is off. The app's own strings live under `app.*` in
  `mobile/src/i18n/messages/`. Numbers inside Arabic sentences are wrapped in
  left-to-right isolates (U+2066…U+2069) — the website's `<v>` tag.
  `@formatjs` polyfills give Hermes Arabic plurals and formatting.
- **Design.** The website's tokens (`mobile/src/theme/tokens.ts`, from
  `globals.css`), IBM Plex Sans Arabic 400–700, light by default with light /
  dark / system as on the site, 44-point touch targets.
- **Navigation.** Routes mirror the website's paths. Each tab is a route group
  with its own stack, and listings and company pages live in a group all tabs
  share, so they open inside the tab the reader is in. Links from outside the
  app — universal links to the website, `brokersconnect://` — are mapped by
  `+native-intent.tsx` (`src/lib/links.ts`): the `/en` prefix and `?src=share`
  come off, other hosts go home, and a listing opens in the Jobs tab with the
  board under it. A website page the app has no screen for offers to open it in
  the in-app browser.

## Links, email and the captcha

- **Universal links.** `/.well-known/apple-app-site-association`
  (`src/lib/apple/app-site-association.ts`) tells iOS which links to the site
  open the app: the board, companies, the directory, notifications, the
  dashboards and `/auth/confirm`; never the code-flow callback, the API,
  unsubscribe links or the admin console. It is served only once `APPLE_APP_ID`
  (`TEAMID.net.brokersconnect.app`) is set on Vercel.
- **Email links** go to `/auth/confirm` with a token hash. The website verifies
  it after a "Continue" press; the app, opening the same URL, verifies it
  itself (`src/lib/auth/confirm-link.ts` reads the link for both).
- **Captcha.** When Supabase Auth requires Turnstile, the app loads
  `/api/mobile/v1/captcha` in a hidden WebView — the site key only runs on the
  site's hostname — and receives the token over the WebView's message channel,
  showing the page only when Cloudflare asks for a person.

## Running and testing

```bash
cd mobile
pnpm install
cp .env.example .env
pnpm start          # needs a development build, see mobile/README.md
pnpm check          # typecheck, lint, the shared-code guard, Jest
pnpm export:ios     # bundle for iOS with Metro and Hermes
```

The Jest suites cover the pure helpers, routing (where each kind of link lands
and where Back goes) and the real screens rendered against fixtures typed with
the API's own shapes. On the website side, `pnpm test:mobile-api` covers the
bearer handling and the registry, and `pnpm smoke:mobile-api` runs the endpoints
against a local production build.

## Configuration

The app is built with three public values (`mobile/.env.example`, and `eas.json`
for EAS builds): the Supabase URL, the publishable key the website also ships
to browsers, and the site URL. Nothing secret is in the app.

On the website, `MOBILE_MIN_APP_VERSION` (Vercel) is the lowest app version
`/api/mobile/v1/config` accepts; below it the app asks to be updated rather than
call an API that has moved on. The other values the later phases need — the
Apple app id for universal links, Sign in with Apple keys, the Expo push token —
are listed where they are introduced.

## Releasing

Builds are made with EAS (`eas.json`): `development` (a development client for
a registered iPhone), `development-simulator`, `preview` (internal
distribution) and `production` (App Store, build number incremented remotely).
Before the first build:

- an Apple Developer Program membership (an organisation needs a D-U-N-S number)
  and an Expo account; `npx eas-cli@latest init` then writes the project id;
- confirm the bundle identifier `net.brokersconnect.app` — it cannot change once
  the app is on the App Store;
- real Privacy Policy and Terms pages on the website (the App Store requires a
  privacy policy URL);
- a 1024-pixel app icon.

The native iOS build is also compiled in CI on `main` (`ios-build` in
`.github/workflows/mobile.yml`), so a config plugin or native dependency that
breaks the build shows up before an EAS build is paid for.
