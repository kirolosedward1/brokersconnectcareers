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

Three kinds of write go straight to Supabase, as the website's browser code
does: notification read-state (the `mark_notifications_read` /
`open_notification` RPCs — the logic is in SQL), the phone's push registration
(`register_push_device` / `unregister_push_device`, likewise all SQL) and file
bytes to Storage (CVs, company documents), whose path is then submitted through
the action, which inspects the file and deletes it if refused.

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
  with its own stack, and listings, company pages and the bell's feed live in
  a group all tabs share, so they open inside the tab the reader is in. The
  tab bar depends on who is signed in (`mobile/src/lib/tabs.ts`, from
  `src/lib/permissions.ts`): signed out it is Home · Jobs · Companies ·
  Account; a candidate's is their console — Home · Jobs · Applications ·
  Saved · Account — with the companies directory a tap from Home (it lives in
  the shared group, so any tab can open it). A tab left out is `hidden`,
  which removes its screens for that person altogether, so every path is
  checked before it is opened, with the website's own rules (`routeAudience` /
  `mayEnter`): a signed-in page with nobody signed in opens the sign-in sheet,
  which comes back to it; a page for somebody else goes home, as the website's
  guards send people home. Links from outside the app — universal links to the
  website, `brokersconnect://` — are mapped by `+native-intent.tsx`
  (`src/lib/links.ts`): the `/en` prefix and `?src=share` come off, other hosts
  go home, a listing opens in the Jobs tab with the board under it, and a few
  pages have another home in the app (`/dashboard` is the home tab,
  `/dashboard/account` the Account tab). Because the profile is read over the
  network, the app keeps the last signed-in person's role on the phone
  (`mobile/src/lib/last-actor.ts`, never an authority) and draws the first
  frame and routes cold-start links for them; when it remembers nobody, a
  signed-in page waits until the stored session has been read. A page opened
  right after a sign-in waits the same way (`open-path.ts`, `PendingPath`), so
  it is never asked of a tab bar not yet drawn for the account. A website page
  the app has no screen for offers to open it in the in-app browser.
- **A candidate's Home** is their overview, the website's `/dashboard`: where
  the account stands when it is held or suspended (`my_account_note`, with the
  appeal panel), the one next action by the website's rule (a reply, else a
  profile under 60%), the `candidate_summary` figures — each a way to where it
  can be changed — the latest three applications, and three roles from the
  board's first page ranked by `rankJobs` with the reasons named (nothing
  already applied to, and newest-first said to be only that). A read that
  failed never says "start here". Then the ways into the board and the
  directory, which a candidate's tab bar has no tab for.
- **Saved.** Bookmarks, saved searches and follows are the website's rows and
  actions (`toggleSavedJob`, `saveSearch`, `setSearchAlerts`,
  `deleteSavedSearch`, `followCompany` / `unfollowCompany`): offered to a
  candidate and, as a way into an account, to somebody signed out; shown at
  once and put back if the server refuses. A follow is a saved search with
  one filter, so the ten-row cap and the weekly email are shared.
- **Applying** is `/jobs/<slug>/apply`, the website's path, so a sign-in that
  began with "apply" comes back to it. The page shows the website's states in
  its order (closed, signed out, not a candidate, held or suspended — told
  before the form, since the database would refuse them — already applied,
  read rather than guessed) and then the form. A CV is either the one on the
  candidate's profile or a PDF/Word file picked on the phone and uploaded to
  `cvs/<uid>/<uuid>.<ext>` first (the file's type from `src/lib/file-type.ts`);
  `applyToJob` then sniffs it, and any refusal takes the upload back out. The
  confirmation offers two more roles ranked by `rankJobs`.
- **The directory profile** is `/account/profile` (the website's
  `/dashboard/profile`, kept in the Account tab): what is missing and why
  (`profileGaps`, the SQL's weights), the form, the sales record and the CV
  sections, each saved by its own website action — entries can be edited as
  well as added. A profile that could not be read is an error, never an
  empty form. A restricted profile says so with the moderator's reason and
  the appeal panel (`submitAppeal`, `my_appeal_state`). "Remove CV" now
  clears the profile's CV on the website too (`saveAgentProfile` ignored
  it); only the column is cleared, since an application may have been sent
  with that file.
- **The bell** sits at the end of each tab's first screen with the unread
  count, read like everything else about the person straight from Supabase.
  Its feed pages by `(created_at, id)` as the website's does, marks read up to
  the newest row shown, and follows a notification through
  `openNotification`, which answers with the page to open or why not.
  Returning to the app re-reads whatever has gone stale meanwhile.

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
- **Account settings** are the website's `/dashboard/account`, split for a
  phone. The photo sits on the Account tab: picked from the library, cropped
  square by the system, written again as a JPEG no wider than 1024 px (which
  is how a HEIC becomes readable) and sent multipart to `uploadImage`; removing
  it is `saveAvatar(null)`. "Sign-in and security" changes the email address
  and the password with Supabase Auth's own `updateUser` (then ends other
  sessions and runs `announcePasswordChange`; an account made with Google or
  Apple is told it has no password), and sets up TOTP — the key opens straight
  in an authenticator on the same phone (`otpauth://`), with the QR code and
  the key for another device. "Emails" is `updateNotificationPreferences`,
  all four switches at once, put back when refused. "Download my data" is
  `/api/account/export`, written to the cache and handed to the share sheet.
  Setting up a second factor now clears an abandoned attempt first, on the
  website too: `listFactors().totp` holds only verified factors, so the
  website's cleanup never found one and a single abandoned setup blocked
  every later one.

## Pushes

A push is a second delivery of a bell notification, never a different one
(migration 329, `src/lib/push/`):

- **Phones.** The app registers its Expo push token with
  `register_push_device` (a definer function it calls directly, like the
  notification read-state functions): the token moves to whoever signs in on
  the phone, and signing out forgets it (`unregister_push_device`). Ten phones
  a person at most.
- **What is queued.** A trigger on `notifications` queues one push for a row
  that is unread and not folded into another — so twenty applicants to one
  listing are one push, as they are one row in the bell — only for people with
  a phone, and it can never fail the notification. The expiry notices the
  night sweep writes wait until nine in Cairo.
- **What is sent.** The bell's own sentence (`notificationTitle`) in the
  phone's language, the unread count as the badge, and the notification's id —
  never the free-text note, which is not for a lock screen. Opening it asks the
  website for the destination (`openNotification`), as the bell does.
- **When.** Right after the action that caused it (`publish()` flushes in
  `after()`), and every minute from `/api/cron/push`, which also reads Expo's
  receipts and switches off phones that no longer have the app. Retries back
  off over five tries; anything a day old is dropped rather than sent late.

Scheduling the minute sweep inside the database needs two Vault secrets, set
by hand in the SQL editor (the repository is public):

```sql
select vault.create_secret('https://www.brokersconnect.net/api/cron/push', 'push_sweep_url');
select vault.create_secret('<the CRON_SECRET set on Vercel>', 'push_sweep_secret');
```

Vercel Cron calls the same route every five minutes as a second caller.

## Reporting and hiding

The App Store asks an app where people publish to one another to let readers
report what is objectionable and block whoever is behind it, and to answer
reports promptly.

- **Report** a listing or a company (and, in the employer's directory, a
  consultant's profile) through the website's `reportTarget` and its dialog's
  rules: an account is required (a signed-out reader is sent to sign in and
  brought back), each target has its own reasons, each with a line saying what
  it covers, none chosen in advance; the database's limits (one per person per
  target, a few in a few minutes, fewer on a new account) each come back in
  their own words. Reports land in the moderation console on the website, and
  the reporter is told when one has been looked at.
- **Hide a company** keeps it out of the board, the home screen, "roles like
  this" and the directory on that phone
  (`mobile/src/features/moderation/hidden-companies.ts`), signed in or not;
  its page says it is hidden and takes it back. Kept on the device — a list of
  company ids the server has no need of.

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
| `EXPO_ACCESS_TOKEN` | Only once "enhanced push security" is on in the Expo project: authenticates the website's pushes. Secret. |

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
