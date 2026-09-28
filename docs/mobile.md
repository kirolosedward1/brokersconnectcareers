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

## Signing in

The sign-in sheet (`mobile/src/app/(auth)/`) is the website's auth form, rule
for rule, over Supabase Auth directly — as the website's browser code does:

- **Password.** Eight characters before anything is sent; GoTrue's refusals in
  the reader's language through the website's own mapping
  (`src/lib/auth/errors.ts`); each failure reported to `reportAuthOutcome`,
  whose advised pause the form honours; the confirmation email offered again
  when an unconfirmed address is what stands in the way.
- **Sign-up** keeps the door's role in user metadata and asks GoTrue for the
  website's own confirmation redirect (`/auth/callback?next=/onboarding…`, with
  the destination nested), so the email works the same opened anywhere.
- **Apple** is the system sheet: a SHA-256 of a random nonce goes to Apple, the
  nonce itself to `signInWithIdToken`, and the name Apple gives only once is
  kept in `user_metadata.full_name`. **Google** runs Supabase's OAuth flow in
  the system's authentication browser with PKCE, returning to
  `brokersconnect://auth/callback`. Each button appears only when
  `/api/mobile/v1/config` says the provider is on.
- **Second factor.** An account with an authenticator is asked for its code
  after any sign-in, before anything else opens (the website asks only in the
  admin console); signing out is the way out for someone without the phone.
- **Onboarding** runs the website's `completeOnboarding` and adds agreeing to
  the Terms of use, which the App Store requires of an app where people publish
  to each other. A session with no profile — just signed in, restored at launch,
  or arriving from a link — is sent there by the session gate
  (`mobile/src/components/navigation/session-gate.tsx`).
- **The Account tab** signs out of this phone only (`scope: 'local'`), and
  deletes the account through `deleteMyAccount` — for an Apple account after
  asking Apple for a fresh authorization code, so the website can revoke the
  grant. An account that owns a company is pointed to the team, as on the web.

## Links, email and the captcha

- **Universal links.** `/.well-known/apple-app-site-association`
  (`src/lib/apple/app-site-association.ts`) tells iOS which links to the site
  open the app: the board, companies, the directory, notifications, the
  dashboards and `/auth/confirm`; never the code-flow callback, the API,
  unsubscribe links or the admin console. It is served only once `APPLE_APP_ID`
  (`TEAMID.net.brokersconnect.app`) is set on Vercel.
- **Email links** go to `/auth/confirm` with a token hash. The website verifies
  it after a "Continue" press; the app, opening the same URL, verifies it
  itself at once (mail scanners do not open apps), asking first only when
  another account is signed in on the phone. `src/lib/auth/confirm-link.ts`
  reads the link for both: a reset opens the new-password screen, a
  confirmation onboarding with the door's role and the destination.
- **Captcha.** When Supabase Auth requires Turnstile, the app loads
  `/api/mobile/v1/captcha` in a hidden WebView — the site key only runs on the
  site's hostname — and receives the token over the WebView's message channel,
  showing the page only when Cloudflare asks for a person. The WebView may load
  that page and Cloudflare's frames and nothing else; a token is spent on each
  attempt and the page reloaded for the next (`mobile/src/features/auth/captcha.tsx`).

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
and where Back goes), the real screens rendered against fixtures typed with the
API's own shapes, and every sign-in path (`tests/auth.test.tsx`) run through the
real supabase-js client against a stand-in for Supabase Auth: what GoTrue is
sent, what the website's actions are asked, and where each flow leaves the
person. On the website side, `pnpm test:mobile-api` covers the
bearer handling and the registry, and `pnpm smoke:mobile-api` runs the endpoints
against a local production build.

## Configuration

The app is built with three public values (`mobile/.env.example`, and `eas.json`
for EAS builds): the Supabase URL, the publishable key the website also ships
to browsers, and the site URL. Nothing secret is in the app.

On the website (Vercel):

| Variable | For |
| --- | --- |
| `MOBILE_MIN_APP_VERSION` | The lowest app version `/api/mobile/v1/config` accepts; below it the app asks to be updated. |
| `APPLE_APP_ID` | `TEAMID.net.brokersconnect.app` — serves the universal-link file. |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID` | The Sign in with Apple key (`.p8`, newlines escaped) and the app's bundle id, used to revoke an Apple user's grant when they delete their account from the app (`src/lib/apple/revoke.ts`). Secret. |
| `SUPPORT_EMAIL` | Already the footer's contact address; the app offers it too (`/api/mobile/v1/config`), and a company owner who wants their account deleted is pointed to it. |

In the Supabase dashboard (Authentication):

- **Providers → Apple**: on, with the Services ID for the website and the
  bundle id `net.brokersconnect.app` among the client ids for the app. Both
  sign-in buttons appear once it is (`enabledProviders()`). The App Store
  requires Sign in with Apple wherever Google is offered.
- **URL Configuration → Redirect URLs**: add `brokersconnect://auth/callback`
  for Google in the app; the email links use the website's own callback,
  which is already listed.

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
