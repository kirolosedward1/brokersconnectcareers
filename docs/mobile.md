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

The other way round, a change only to `mobile/` does not build the website:
`vercel.json`'s `ignoreCommand` skips the deployment when nothing outside
`mobile/` (and the app's workflow) changed since the last deployment that
succeeded (`VERCEL_GIT_PREVIOUS_SHA`). It compared with the previous commit
alone before, so a push of several commits whose last one touched only the app
skipped the website changes in the commits before it. When that deployment's
commit is not in Vercel's shallow clone, the build runs; with no deployment to
compare with (a new branch), it compares with the previous commit.

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
- **Design.** The brand set in a quieter key for the phone
  (`mobile/src/theme/tokens.ts`): ivory paper with deep sapphire ink in light,
  near-black with champagne in dark, champagne kept for what has been checked
  (a verified company); every text pair 4.5:1, marks and field borders 3:1.
  Cards raised with a hairline and a soft shadow, continuous corners, capsule
  buttons and chips, a gentle press (none with Reduce Motion), a few haptics
  (`mobile/src/lib/haptics.ts`). IBM Plex Sans Arabic 400–700, light by
  default with light / dark / system as on the site, 44-point touch targets.
- **Navigation.** Routes mirror the website's paths. Each tab is a route group
  with its own stack, and listings, company pages and the bell's feed live in
  a group all tabs share, so they open inside the tab the reader is in. The
  tab bar depends on who is signed in (`mobile/src/lib/tabs.ts`, from
  `src/lib/permissions.ts`): signed out it is Home · Jobs · Companies ·
  Account; a candidate's is their console — Home · Jobs · Applications ·
  Saved · Account — with the companies directory a tap from Home (it lives in
  the shared group, so any tab can open it); an employer's is theirs — Home
  (the `/employer` overview) · Listings · Applicants · Consultants (once the
  directory answers them: `canBrowseAgentDirectory`, an approved employer) ·
  Account (where the company, team and billing are kept) — and has no board:
  a listing opens at home, and the board's own address goes home. A listing's
  applicants (`/employer/jobs/<id>/applicants`) open in whichever of Listings
  and Applicants the employer is in, and a consultant's page (`/agents/<slug>`)
  in whichever tab it was opened from. A tab left out is `hidden`,
  which removes its screens for that person altogether, so every path is
  checked before it is opened, with the website's own rules (`routeAudience` /
  `mayEnter`): a signed-in page with nobody signed in opens the sign-in sheet,
  which comes back to it; a page for somebody else goes home, as the website's
  guards send people home. Links from outside the app — universal links to the
  website, `brokersconnect://` — are mapped by `+native-intent.tsx`
  (`src/lib/links.ts`): the `/en` prefix and `?src=share` come off, other hosts
  go home, a listing opens in the Jobs tab with the board under it, and a few
  pages have another home in the app (`/dashboard` and `/employer` are the
  home tab, `/dashboard/account` the Account tab). Because the profile is read over the
  network, the app keeps the last signed-in person's role on the phone
  (`mobile/src/lib/last-actor.ts`, never an authority) and draws the first
  frame and routes cold-start links for them; when it remembers nobody, a
  signed-in page waits until the stored session has been read. A page opened
  right after a sign-in waits the same way (`open-path.ts`, `PendingPath`), so
  it is never asked of a tab bar not yet drawn for the account. A website page
  the app has no screen for offers to open it in the in-app browser.
- **An employer's Home** is the website's `/employer` overview: the one next
  action (`employerNextAction`, shared), where the account and the company
  stand (a first review, a hold, a suspension — the company's with its own
  reason from `company_moderation` and its own appeal), the setup checklist
  until there is a listing, then the `employer_summary` figures in two strips
  and `employer_trend`'s month as bars with each live listing's conversion.
  A suspended account sees its standing and the appeal, which the website's
  console never shows it. **Listings** (`/employer/jobs`) is the website's
  console read, twenty-five at a time: the status by date as well as label
  (`displayJobStatus`), the rejection note and the appeal, and only the moves
  an employer may make through `transitionJob`, with the website's words for
  each refusal. **The job wizard** (`/employer/jobs/new`,
  `/employer/jobs/<id>/edit`) is the website's four steps, each checked before
  the next with the schema's own rules (numbers typed with either set of
  digits); leaving the first asks `findSimilarListing` and
  `salaryReferenceFor` in the background; the review shows the advert with the
  listing's own compensation card. `saveJob` gets one idempotency key per form
  and the version the form was built from, so a retry never posts twice and a
  colleague's save is never overwritten; a refusal sends the employer back to
  the step that holds it. A live listing is edited, never drafted.
  **Applicants** — one listing's pipeline by stage, and the inbox across all of
  them with the website's filters in the address and stage counts under them —
  are the website's reads (the newest two hundred, under the employer's own
  session). Each card is the website's: the directory profile when the company
  may see it and a word saying so when not, WhatsApp with `employerOpener`'s
  first message, the CV (`/api/cv/<id>` as JSON, opened in the in-app browser),
  the move with `from` and the decision note always sent (the action writes
  the note on every move), the reason to the candidate, and the private
  notes. Cards on screen are stamped seen with `markApplicantsSeen`.
  **The company** (`/employer/company`) and **billing** (`/employer/billing`)
  sit in the Account tab. The company page offers what the roster allows, as
  the website does: the logo (picked as drawn, sent as a PNG so a transparent
  ground stays, through `uploadImage`), the profile (`saveCompany` on the
  version it loaded, an address without a scheme given `https://`, anything
  but http(s) refused before sending), the verification papers (bytes to
  `company-documents/<company>/…` first, then `recordCompanyDocument`, the
  upload taken back out on a refusal) and the team (`addCompanyMember` /
  `removeCompanyMember`). Billing is read-only — credits, orders and the
  monthly free post for a verified company, granted only when the database
  says it was — and sells nothing.
  **The consultant directory** (`/agents`, the Consultants tab) is the
  website's search through `/api/mobile/v1/agents`, its filters in the address
  (`src/lib/agent-filters.ts`, shared) and in a sheet that counts as the
  employer chooses; cards are anonymous until the company is verified, and a
  company that is not is told why once — the papers are a company admin's to
  upload, so a recruiter is told who can. **A consultant's page**
  (`/agents/<slug>`, or `/agents/<id>` for a locked card) reads
  `get_agent_card()` and the CV under the employer's own session, so the
  database decides what shows; the number and the CV are asked for with
  `revealAgentContact` (counted and limited, its refusals in the website's
  words) and `/api/agent-cv/<handle>` as JSON, and the company's look is
  recorded with `recordAgentView` (a new registry entry; the database decides
  whether it counts). **The shortlist** (`/employer/talent`) is
  `saved_agent_cards()`, which says what may still be shown of each — a
  consultant who has since hidden their profile is a row with nothing but that
  — and `toggleSavedAgent`, shown at once and put back when refused. An
  applicant's profile panel opens their page for a company the directory
  answers.
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
  with that file. "See your profile as companies see it" opens
  `/account/profile/preview`: the same page an employer reads, from
  `get_agent_card()` (which answers its owner whatever the visibility), with
  the website's owner banner saying which audience sees what, the candidate's
  own CV, and nothing to report, keep or count.
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
  (`mobile/src/components/navigation/session-gate.tsx`). Its ways out are
  signing out and deleting the account, which runs the Account tab's own path
  (`mobile/src/features/account/delete.ts`); the website's onboarding page has
  the same two (`src/components/auth/leave-onboarding.tsx`).
- **The Account tab** signs out of this phone only (`scope: 'local'`), and
  deletes the account through `deleteMyAccount` — for an Apple account after
  asking Apple for a fresh authorization code, so the website can revoke the
  grant. An account that owns a company cannot be deleted at a tap — the
  company, its listings and other people's applications would go with it — so
  its owner asks for it instead, in the app or on the website
  (`requestAccountDeletion`, a support request under the `account_deletion`
  topic, migration 330), and is told how long it takes; the admin console's
  overview lists the open requests until the team has agreed what happens to
  the company, done it, and closed them.
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
- **New listings.** Once a day (`/api/cron/new-jobs`, 07:17 UTC: nine or ten
  in Cairo), every saved search with alerts on — a followed company is one —
  runs through the board's own query, and what was published since it was
  last looked at, less what the person applied to, becomes one bell
  notification for the day (`new_jobs`, migrations 333–334,
  `src/lib/new-jobs.ts`): naming the one search or company that found it, or
  counting. It reaches the phone like any other. The Monday email is unchanged.
- **What is sent.** The bell's own sentence (`notificationTitle`) in the
  phone's language, the unread count as the badge, and the notification's id —
  never the free-text note, which is not for a lock screen. Opening it asks the
  website for the destination (`openNotification`), as the bell does.
- **When.** Right after the action that caused it (`publish()` flushes in
  `after()`), and every minute from `/api/cron/push`, which also reads Expo's
  receipts and switches off phones that no longer have the app. Retries back
  off over five tries; anything a day old is dropped rather than sent late.
- **On the phone** (`mobile/src/features/push/`, `PushBridge` beside the root
  stack). Permission is asked for with a reason — a card on Home saying what
  the person would hear about ("not now" puts it away) — never at launch; the
  Account tab's "Notifications on this phone" (`/account/alerts`) turns them
  off for this person on this phone without the phone's settings, and says so
  when the phone's settings have them off, with the way there. With them on,
  it also has the person's choices for all their phones (migration 335, on
  the profile beside the email switches, saved with `updatePushPreferences`):
  new listings (a candidate's only), applications, and everything else, each
  on or off, and quiet hours — what comes between 23:00 and 08:00 Cairo time
  waits until eight; off unless turned on. `enqueue_push` applies them where
  pushes are queued, so a kind turned off still reaches the bell. The phone is
  registered at every launch for somebody with a profile who allowed it
  (which keeps `last_seen_at` fresh) and again when its token changes.
  Signing out forgets the phone first (`signOutHere`, before the session
  goes); a session that ended any other way — revoked from another device,
  a refresh refused, another account's email link opened on the phone —
  makes the phone stop listening (Apple's registration), and the next
  person's registration comes after that stop. A tapped push, the one that
  launched the app included, is opened as the bell opens a notification, once
  it is known who is signed in; the icon's badge follows the bell's count. A
  push arriving while the app is open shows as a banner and refreshes the
  bell. The APNs environment follows the EAS build profile (`app.config.ts`):
  a development build uses the sandbox, everything else production.

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
  company ids the server has no need of — and read before the app draws
  anything, since a cold start draws the board kept from the last run at once.

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
pnpm start:go       # for the Expo Go app, below
pnpm start          # for a development build, see mobile/README.md
pnpm check          # typecheck, lint, the shared-code guard, Jest
pnpm export:ios     # bundle for iOS with Metro and Hermes
```

### Against the real stack

The Jest suites answer Supabase and the website from fixtures. Two checks send
the same requests to the real thing, in CI and on a computer:

- **The contract replay** (the Mobile workflow's `contract` job) records every
  database request the tests make and replays each distinct one against a real
  Postgres 16 built from the migrations and seeds, behind a real PostgREST 12,
  signed as a seeded candidate or employer, or as nobody. A column, embed,
  function or grant the fixtures answer but the schema refuses fails it.

  ```bash
  (cd mobile && RECORD_REQUESTS=/tmp/requests.jsonl npx jest)
  POSTGREST_BIN=/path/to/postgrest node scripts/contract/replay.mjs /tmp/requests.jsonl
  ```

- **The journeys** (`.github/workflows/e2e.yml`, "End to end") start Supabase
  from the migrations and the seed, make the demo accounts, build and start the
  website against it, and send what the phone sends: the password grant, reads
  under row-level security, CV bytes to Storage, server actions through
  `/api/mobile/v1`. Then they check what the database holds: an application
  with its CV, the employer opening, noting and moving it, the move in the
  candidate's bell, a listing sent for review, an account made, onboarded and
  deleted. With Docker running:

  ```bash
  supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime
  # .env.local from `supabase status -o env`: the API URL, the anon and
  # service keys, and DATABASE_URL
  DEMO_PASSWORD=… node scripts/seed-demo.mjs
  pnpm build && pnpm start
  SITE_URL=http://localhost:3000 SUPABASE_URL=http://127.0.0.1:54321 \
    SUPABASE_ANON_KEY=… DEMO_PASSWORD=… node scripts/e2e/journeys.mjs
  ```

  They refuse to run against production: they sign in as the demo accounts,
  apply, move applications, post a listing and delete an account they make.
  The replay builds its own database and never connects to one.

### Trying it in Expo Go

The quickest way onto a phone, with no Apple developer account: install Expo Go
from the App Store, run `pnpm start:go` on a computer on the same Wi-Fi as the
iPhone, and scan the QR code it prints with the iPhone's camera
(`pnpm start:go --tunnel` when the two are not on the same network). Right to
left comes from `extra.forcesRTL` in `app.config.ts`, which Expo Go reads from
the manifest.

Sign in first, on both sides, to the same Expo account (a free one will do):
`npx expo login` on the computer, and the account icon in Expo Go's top corner
on the phone. An iPhone's Expo Go opens a project from a computer only then, and
otherwise stops at "You need to be signed in to Expo Go and Expo CLI"; the
tunnel needs the login too. The iOS Simulator does not ask.

#### Without a computer running

The app can also be published to Expo's servers as an update that Expo Go
opens by itself, so the phone needs only the internet. It is the same code,
with the store build's settings (it talks to production), on its own
`expo-go` channel. It uses Expo Go's runtime version (`exposdk:57.0.0`), not
the fingerprint store builds take (`EXPO_GO_UPDATE` in `app.config.ts`).

Once, with the Expo account Expo Go is signed in to: an access token
(expo.dev → Account settings → Access tokens) as the repository secret
`EXPO_TOKEN` (GitHub → the repository's Settings → Secrets and variables →
Actions). That is all Expo Go needs. While `app.config.ts` carries no EAS
project id, a publish finds the app's project (slug `brokers-connect`) on the
token's account, or creates it the first time, with Expo's own `eas init`
(`scripts/publish-update.mjs`). The run's summary then gives the project's id:
it goes in `app.config.ts` in place of `null` (`EAS_PROJECT_ID`) for builds and
push notifications. It is not a secret.

Then, each time the phone should get the newest code:

- from GitHub: Actions → Expo Go → Run workflow (on any branch). It also runs
  by itself on pushes to `main` and on this repository's pull requests. The
  run's summary links the QR code;
- or from a computer, signed in with `npx eas-cli@latest login`:
  `pnpm run ota expo-go --message "what changed"` in `mobile/`, which finds or
  creates the project the same way and prints the same link.

On the phone, Expo Go lists the app under Projects (signed in to the same
account), or scan the QR code on that page with the camera. Expo Go opens the
app and keeps it in its list, so later it is one tap. Each publish replaces
what it opens next.

Expo Go from the App Store runs one SDK at a time. Today that is 57, this
app's. When it moves to the next SDK, the app has to move too
(`npx expo install expo@latest --fix`) before Expo Go opens it again. A build
of the app itself (`docs/app-store.md`) does not depend on that.

Expo Go runs the app as itself, not as `net.brokersconnect.app`, so a few
things need a development build instead:

- Sign in with Apple: Apple issues the token to Expo Go, so the app does not
  show the button there. Email and password, and Google, work.
- Push notifications, which need the EAS project (`EAS_PROJECT_ID` in
  `app.config.ts`) and a build. Until a build has a project, the app offers
  none: no prompt on Home, and a sentence in place of the switch under
  Account → Notifications (`pushAvailable()` in `src/features/push/device.ts`).
- Links that open the app (universal links and `brokersconnect://`). Expo
  Go's own `exp://…/--/<path>` links do open the page they name.
- The version on the Account screen, and the one the update gate compares, is
  Expo Go's own.

The app talks to production (the values in `.env`), so it works once the
website and database carry what it relies on: the release in
`docs/release/2026-09-prod-reconciliation.md`.

The Jest suites run as close to the phone as Node allows, because code that
passed them has failed on the phone twice:

- The phone's Intl: `tests/setup.ts` forces the formatjs polyfills the app
  loads on Hermes (`src/lib/intl-polyfills.ts`), with the same few locales. A
  formatter that worked in Node threw on every job card on the phone.
  `tests/intl.test.ts` runs each shared formatter, and each catalogue message
  with a number, plural, choice or date, on both Intls and requires the same
  text.
- The phone's engine: the setup removes what Node has and Hermes lacks
  (`toSorted`, `Object.groupBy`, `Map.groupBy`, `Array.fromAsync`, iterator
  helpers, `ArrayBuffer#transfer`).
- The phone's compiler: `jest.config.js` has babel-preset-expo run React
  Compiler, as Metro does for the app.
- The phone's fetch: Expo replaces it with its own, which builds a multipart
  body with rules of its own. Tests that upload put the form the app sent
  through Expo's conversion (`tests/multipart.ts`); photos and logos once
  passed every test and failed on every phone.

The suites cover the pure helpers,
routing (where each kind of link lands and where Back goes), the real screens
rendered against fixtures typed with the API's own shapes, and every sign-in
path (`tests/auth.test.tsx`) run through the
real supabase-js client against a stand-in for Supabase Auth: what GoTrue is
sent, what the website's actions are asked, and where each flow leaves the
person. On the website side, `pnpm test:mobile-api` covers the
bearer handling and the registry, and `pnpm smoke:mobile-api` runs the endpoints
against a local production build.

### On a phone, before a release

The tests run the app's code, not the phone: what only a real phone shows is
checked by hand, on a development build (`eas.json`, `development`) against
production, with QA accounts made for it — never the demo accounts.

- Signed out: the board's results match the website's for the same filters; a
  listing, a company, sharing a listing.
- Sign up with email: the confirmation email's link opens the app and leads to
  onboarding; Sign in with Apple, and with Google (the browser comes back to
  the app signed in, with no error behind it).
- Candidate: apply with a CV from Files; the employer sees the applicant and
  opens the CV; both emails arrive; the candidate sees "opened".
- Employer: move an applicant — the candidate gets the push and the email;
  post a listing — it waits for review; add a note on a weak connection.
- Pushes: allow them from the prompt on Home, get one with the app closed,
  tap it; the icon's number follows the bell; sign out — no more arrive.
- Push settings (Account → notifications on this phone): with applications
  off, a moved applicant reaches the bell but not the lock screen; with quiet
  hours on, a push made after eleven at night arrives at eight, Cairo time.
- A saved search with alerts on: the next morning the bell has the day's new
  listings that match it.
- Onboarding: "Delete this account" under signing out deletes an account that
  never finished it, and the app is back at the start.
- An over-the-air update (`pnpm run ota preview --message "…"` to a preview
  build): it shows after the app is closed and opened twice.
- Offline (airplane mode): the screens say so rather than spin; signing out
  still works, in a few seconds.
- Arabic on the phone: numbers, prices and "days ago" read as on the website.
- A link to a listing on the website, tapped in Mail or WhatsApp, opens the
  app (once `APPLE_APP_ID` is set).
- Delete a QA account from the app; for one made with Apple, Apple's
  "Sign in with Apple" list no longer shows the app.
- On Android as well, when it ships: every form's lowest field stays above the
  keyboard, Back on onboarding and the second factor stays put, and the tab
  icons show.

## Configuration

The app is built with three public values (`mobile/.env.example`, and `eas.json`
for EAS builds): the Supabase URL, the publishable key the website also ships
to browsers, and the site URL. Nothing secret is in the app.

On the website (Vercel):

| Variable | For |
| --- | --- |
| `MOBILE_MIN_APP_VERSION` | The lowest app version `/api/mobile/v1/config` accepts; below it the app asks to be updated. |
| `MOBILE_APP_STORE_URL` | The app's App Store page (`https://apps.apple.com/...` only), where the "update the app" screen leads; unset until the app is listed. |
| `MOBILE_MIN_ANDROID_APP_VERSION` | The same floor for the Android app, whose builds are numbered apart; `MOBILE_MIN_APP_VERSION` when unset. |
| `MOBILE_PLAY_STORE_URL` | The app's Play Store page (`https://play.google.com/...` only), where the Android app's "update the app" screen leads. |
| `ANDROID_CERT_SHA256` | The Android signing certificate's SHA-256 fingerprint (`AB:CD:…`, from `eas credentials` or the Play Console's app signing page; several, comma-separated). Serves `/.well-known/assetlinks.json`, so links to the site open the Android app. |
| `APPLE_APP_ID` | `TEAMID.net.brokersconnect.app` — serves the universal-link file. |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID` | The Sign in with Apple key (`.p8`, newlines escaped) and the app's bundle id, used to revoke an Apple user's grant when they delete their account from the app (`src/lib/apple/revoke.ts`). Secret. |
| `SUPPORT_EMAIL` | Already the footer's contact address; the app offers it too (`/api/mobile/v1/config`), beside a company owner's in-app deletion request. |
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

What App Store Connect asks, and the answers the code gives — the privacy
label, the guidelines that apply, review notes — is in `docs/app-store.md`.

Builds are made with EAS (`eas.json`): `development` (a development client for
a registered iPhone), `development-simulator`, `preview` (internal
distribution) and `production` (App Store, build number incremented remotely).
Before the first build:

- an Apple Developer Program membership (an organisation needs a D-U-N-S number)
  and an Expo account; `npx eas-cli@latest init` prints the project id, which
  goes into `mobile/app.config.ts` (`EAS_PROJECT_ID`, in place of null). Push
  tokens are issued for it, and the build server reads that file again, so an
  id set only in a local shell leaves a build that cannot register for pushes;
- an APNs key for pushes, uploaded with `npx eas-cli@latest credentials`
  (Expo sends to Apple with it);
- confirm the bundle identifier `net.brokersconnect.app` — it cannot change once
  the app is on the App Store;
- the privacy policy's section on the app (`content/legal/privacy.ar.md`)
  reviewed — the App Store requires a privacy policy URL;
- a 1024-pixel app icon.

The whole list, in order, with the website's keys and Android's, is in
`docs/app-store.md` ("Before the first submission").

### Over-the-air updates

A build on the App Store keeps taking new JavaScript and images without
another review: `expo-updates` asks Expo's update service at launch, downloads
in the background, and runs the update from the next launch, so nobody's
screen changes under them (`app.config.ts`, `updates`). Each build listens on
its profile's channel in `eas.json` (`production`, `preview`); a development
build loads code from your computer instead. Without an EAS project id updates
are off, and a build runs the code it was built with.

Publish with the script, never a plain `eas update`:

    cd mobile
    pnpm run ota production --message "what changed"

A build takes only an update made for its own native code: the runtime
version is a fingerprint of the configuration as evaluated, and the
configuration follows the build's environment (the APNs mode follows
`EAS_BUILD_PROFILE`, the website's host `EXPO_PUBLIC_SITE_URL`). EAS sets
those from `eas.json` during a build but not when an update is published, so a
plain `eas update` computes another fingerprint and its update reaches nobody —
and it bundles whatever Supabase address and key the machine's `.env` holds.
The script publishes with the profile's own values from `eas.json`, iOS only
unless `--platform` is given. `scripts/publish-update.test.mjs` (in
`pnpm check`) checks both, against the real `eas.json` and `app.config.ts`.

What cannot go out this way is anything native: a new native module, a
permission string, the icon, a config plugin's settings. Those change the
fingerprint and need a new build (and a review); updates published after it
go to that build only. What is not native stays out of the fingerprint
(`mobile/fingerprint.config.js`): Expo counts `package.json`'s scripts and
`.gitignore` by default, and adding a check to `scripts` would have cut every
installed build off from later updates without a word. The same test computes
the fingerprint and checks what it is made of. So the first App Store build already carries the
native modules this round's later features need — `expo-store-review` for the
rating prompt, `expo-local-authentication` for the app lock — and those
features can follow over the air.

The native iOS build is also compiled in CI on `main` (`ios-build` in
`.github/workflows/mobile.yml`), so a config plugin or native dependency that
breaks the build shows up before an EAS build is paid for. It runs on demand
too: Actions → Mobile → Run workflow, on any branch. It builds with Xcode 26,
as EAS does for SDK 57. Xcode 16 cannot build SDK 57: `expo-modules-jsi`'s
Swift package needs Swift tools 6.2, and `@expo/ui`, which `expo-router`
depends on, uses iOS 26 SwiftUI API. A Mac building locally needs Xcode 26 as
well.
