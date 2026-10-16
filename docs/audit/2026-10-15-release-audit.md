# Pre-release technical audit — 2026-10-15

Scope: the whole repository at `main` (`90d70f9`): the Expo iOS app (`mobile/`),
the Next.js website and its `/api/mobile/v1` backend, the Supabase schema and
migrations, CI workflows, build and store configuration. And, read-only, what
production actually runs: the Vercel project behind `www.brokersconnect.net`
(environment variable names only, never values), its public endpoints, and the
GitHub Actions history on `main`.

Nothing was taken on trust from the docs: each finding below names the command,
file or endpoint that shows it.

## Verdict

| Area | Result |
| --- | --- |
| Code: typecheck, tests, build, bundle | **PASS** |
| Dependencies (website) | **PASS** after this audit's fix |
| Dependencies (app) | **PASS with notes** — advisories are in build/dev tooling only |
| Secrets in the repository and its history | **PASS** |
| Production configuration | **FAIL** |
| Release readiness (App Store submission) | **FAIL** |

**Overall: FAIL — not ready for production release.** The code is in good
shape; what fails is the environment it runs in. Production is missing the
server key that account deletion, CV viewing, email, pushes and every cron
depend on; Sign in with Apple is off while Google is on; no backups are
being taken; and the on-device Expo Go check is red on `main`. None of these
can be fixed from the repository — they are owner actions, listed in order
under P0/P1.

## What was run

| Check | Command | Result |
| --- | --- | --- |
| Website suites (typecheck, catalogue, licences, legal, ~40 node suites, PGlite DB/RLS/security/lifecycle/concurrency) | `pnpm check` | 3,249 assertions, 0 failed |
| Website production build | `pnpm build` | passes, no warnings (Next 15.5.27) |
| Migration lint | `pnpm db:lint` | 122 migrations, nothing unacknowledged |
| Website lint | `pnpm lint` | **broken** — see M2 |
| App typecheck, ESLint, shared-code guard, OTA-publish check, licences, Jest | `cd mobile && pnpm check` | 45 suites, 837/837 tests |
| App iOS bundle through Metro + Hermes | `cd mobile && pnpm export:ios` | passes (7.1 MB `.hbc`) |
| Expo doctor | `npx expo-doctor` | 19/21; the 2 failures need `exp.host`, unreachable from the audit sandbox — not verified |
| Dependency advisories | `pnpm audit` (both roots) | website: 0 after fix; app: see L1 |
| Secret scan, tree and full history | `git grep` / `git log -p -G` for Supabase secret keys, JWTs, Stripe/Resend/AWS/GitHub/Google keys, private keys, `.env`, `.p8/.p12` | nothing found |
| TODO / FIXME / mock / placeholder / lorem / `console.log` | `git grep` over `src`, `mobile/src`, `scripts`, migrations | none in shipped code |
| Unreferenced modules | import-graph sweep of `src/lib`, `mobile/src` | 4 web modules, see L3 |
| CI on `main` | GitHub Actions | Web, Mobile, End to end, iOS screens green; **Expo Go red**; DR backup "green" but skipped |

The public `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` values in `eas.json`,
`mobile/.env.example` and workflows (Supabase URL, `sb_publishable_…` key, site
URL) are client-side by design and protected by RLS; they are not findings.

## Fixed in this audit

| Change | Why | Verified by |
| --- | --- | --- |
| `next` 15.5.24 → **15.5.27** (`package.json`, lockfile) | Two moderate Next.js advisories (SSG/ISR cache poisoning, cross-user content) affecting `>=15.0.0 <15.5.27`. Patch release on the same line; 15.5.27 chosen over 15.5.28 because the latter was one day old. | `pnpm audit` clean; `pnpm build`; `pnpm check` 3,249/0 |
| `source-map-js` override `^1.2.2` (`pnpm-workspace.yaml`) | High advisory (event-loop DoS via crafted indexed source map) in the copy postcss/Tailwind use at build time. | same |
| `src/lib/licenses/web.json` regenerated | The repo's licence check requires the shipped inventory to match the installed versions. | `pnpm test:licenses` |

No business logic was changed. The app (`mobile/`) is untouched: its lockfile
feeds EAS builds and the update fingerprint, and its advisories are not
reachable from the shipped bundle (L1).

## Remaining issues, by priority

### P0 — blocks release

**P0-1. Production has no `SUPABASE_SERVICE_ROLE_KEY` (and other server keys).**
*Evidence:* the Vercel project `brokersconnectcareers` (which serves
`www.brokersconnect.net`) holds exactly eight variables: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `BILLING_ENABLED`,
`CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `PAYMOB_API_KEY`.
`GET /api/health` answers `{"status":"degraded"}`. Per `docs/app-store.md`
step 1 and the merge commit of PR #33, without the service key: **account
deletion answers "unavailable"** (an App Store requirement, guideline
5.1.1(v)), employers **cannot open applicants' CVs** or company documents, team
invites, view counts, emails, pushes and the crons do nothing, and migrations
346–349 cannot be applied. Also absent: `SECURITY_SALT`, `RESEND_WEBHOOK_SECRET`,
`APPLE_APP_ID`, the four `APPLE_*` revocation values, `SUPPORT_EMAIL`
(falls back to the operator address, fine).
*Fix (owner):* set them in Vercel → Settings → Environment Variables
(Production), redeploy, confirm `/api/health` with the cron secret as bearer
reports nothing under `attention`, then `pnpm db:apply` for 346–349
(`docs/release/2026-09-prod-reconciliation.md`).

**P0-2. Sign in with Apple is off while Google is on.**
*Evidence:* production `GET /api/mobile/v1/config` →
`"providers":{"google":true,"apple":false}`. The app shows each button only
when the provider is on (`docs/mobile.md`, Signing in), so the build would offer
Google without Apple — an App Review rejection under guideline 4.8.
*Fix (owner):* Supabase → Authentication → Providers → Apple, with the Services
ID and the bundle id `net.brokersconnect.app` among the client ids; the
`APPLE_*` keys from P0-1 for revocation on deletion. Or turn Google off for the
first submission.

**P0-3. No backups are being taken.**
*Evidence:* every nightly "DR backup" run on `main` (e.g. run 38683950975,
2026-10-15) finishes in ~5 s with every step after `Configured?` skipped —
the workflow exits green when its `DR_*` secrets are missing
(`.github/workflows/dr-backup.yml`). Whether PITR is on in Supabase could not
be checked (the Supabase connector was unreachable). The security report
(`docs/security/SECURITY_REPORT.md` §15) also lists backups as "Not yet".
*Fix (owner):* add the eight `DR_*` repository secrets, run the workflow by hand
once, and do one restore rehearsal (`docs/recovery-runbook.md`). Turn on PITR.

### P1 — fix before or right after submission

**P1-1. The Expo Go on-device check is red on `main`.**
*Evidence:* Expo Go run 37616658508, job `look`: `Expo Go: 2-home 7-home-again`.
At both steps the simulator's screen text was still the welcome (headline,
"إنشاء حساب", "تسجيل الدخول", "صاحب شركة؟") after Maestro tapped "تخطي" (Skip),
and again after relaunching. Either Skip did not dismiss the welcome (or its
answer was not kept) in Expo Go, or the flow tapped before Skip had faded in
(`Appear` delay `BEAT + 640` ms in `mobile/src/app/welcome.tsx`). Jest covers the
welcome and passes, so this is not reproducible here (needs macOS).
Skip is what App Review uses to browse without an account.
*Fix:* download the run's `expo-go-screens` artifact and its `maestro.log`; try
Skip on a real iPhone in Expo Go and on a development build. If it is the
timing, add `extendedWaitUntil: visible: "تخطي"` before the tap in
`mobile/maestro/expo-go-browse.yaml`.

**P1-2. Bot protection is off.**
*Evidence:* production config → `"turnstileSiteKey":null`; the Turnstile
variables are absent on Vercel. Sign-in, sign-up and reset are protected only
by Supabase Auth's default rate limits. This is item 2 of the security report's
"five actions that flip the verdict"; items 3–5 (firewall, alerts, staging
abuse test) could not be confirmed from here either.
*Fix (owner):* `SECURITY_REPORT.md` §15.

**P1-3. Universal links are not served.**
*Evidence:* `GET /.well-known/apple-app-site-association` → 404 (it is served
only once `APPLE_APP_ID` is set). Links to listings in WhatsApp/Mail open the
website, not the app, and password AutoFill from the site will not be offered.
*Fix (owner):* `APPLE_APP_ID=TEAMID.net.brokersconnect.app` on Vercel (part of P0-1).

**P1-4. Production board content.** `docs/app-store.md` records (2026-10-02)
that production had no live real listings and still held the seeded demo data.
Not re-checked (database unreachable from here). An app that opens empty is a
likely rejection. *Fix (owner):* `pnpm remove-demo`, then real listings,
before screenshots and submission.

### P2 — technical debt

**M1. Next.js 15 is a major version behind** (latest 16.4). 15.5 still receives
backports (15.5.28 shipped 2026-10-14), so there is no urgency; plan the move,
which also removes `next lint` (M2).

**M2. The website has no linter.** `pnpm lint` runs `next lint`, which is
deprecated, finds no ESLint config or dependency, and stops at an interactive
prompt (exit 1). CI (`.github/workflows/web.yml`) does not lint the website, so
only `tsc` guards it; the app is linted. *Fix:* migrate with
`npx @next/codemod@canary next-lint-to-eslint-cli .`, add `eslint` +
`eslint-config-next`, triage the first run's findings in their own change, then
add `pnpm lint` to `web.yml`. Not done here: it adds dependencies and will
surface findings that each need a decision.

**M3. No server-side error capture.** `src/lib/telemetry/event.ts` describes
`server_error`s "captured by instrumentation.ts", but no `instrumentation.ts`
exists and nothing imports the telemetry module (L3). Errors reach Vercel's
logs only. *Fix:* add an `instrumentation.ts` with `onRequestError` wired to the
existing telemetry code, or an error-monitoring service.

### P3 — low

**L1. App dependency advisories, all in build/dev tooling.** `pnpm audit` in
`mobile/`: `shell-quote` (critical; via `react-native › react-devtools-core`,
dev-only), `node-forge` (high; Expo CLI, no patched release), `source-map-js`
(high; Metro's postcss), `braces`, `sprintf-js` (Jest), `uuid` (Expo's `xcode`
config tooling), `decode-uri-component` (via `expo-router › query-string`, DoS on
crafted input). None but the last reaches the Hermes bundle, and that one only
burns the phone's own CPU on a malformed link. *Fix:* when Expo next bumps
these, or add `pnpm.overrides` for `shell-quote ^1.11.0` and
`source-map-js ^1.2.2` in `mobile/pnpm-workspace.yaml` with a new development
build and a fingerprint check.

**L2. Mobile action body limit is weaker than its comment.**
`src/lib/mobile-api/http.ts` `readActionInput` says an undeclared length "is
counted as it arrives", but multipart bodies without `content-length` are read
whole by `request.formData()`, and JSON is measured after `request.text()`.
Vercel's 4.5 MB request cap bounds both, and `uploadImage` checks size itself,
so this is a comment to correct or a streaming check to add.

**L3. Dead code.** Never imported: `src/lib/telemetry/{event,rules,scrub,context}.ts`,
`src/lib/support/reference.ts` (support references; the `record_support_event`
RPC exists in the schema but the app never calls it) and
`src/lib/security/turnstile.ts` (server-side Turnstile verification — its header
says server actions use it; none does, GoTrue verifies the tokens instead).
*Fix:* wire them up (M3) or delete them; left in place here because the database
half of the support-reference feature exists and the choice is the owner's.

**L4. The site host is written twice in the app.** `mobile/src/lib/links.ts`
hardcodes `https://www.brokersconnect.net`, while `app.config.ts` and
`src/lib/env.ts` take `EXPO_PUBLIC_SITE_URL`. A staging build would accept
universal links for staging (from the config) but map them as foreign and open
Home. Production is unaffected.

**L5. Android is not release-ready**, by design for now: no
`GOOGLE_SERVICES_JSON` (no pushes), no `ANDROID_CERT_SHA256` (App Links), no
Play Store URL. iOS is the first target.

**L6. Store assets.** The icon is the 450 px mark upscaled to 1024 px
(opaque, accepted by the store, slightly soft); `docs/app-store.md` step 5 already
suggests a vector redraw.

## What was checked and found sound

The mobile API door (`withMobileAuth`: bearer shape, one verification per
request, cookies never read on mobile routes, 401 vs 503 kept apart), the action
registry (allow-list, no admin or checkout actions, positional arguments
validated), session storage (AES-GCM sealed session, key in the Keychain
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), deep-link mapping (foreign hosts go
home, audience checked before opening), external URLs (`safeHttpUrl` before
`openURL`; WhatsApp links are always `https://wa.me/<digits>` from the shared
`whatsappLink`), the captcha WebView (Cloudflare
frames only), the Paymob webhook (HMAC before any read, refuses without a
secret), demo sign-in (off unless a build sets it; not set on Vercel), and the
privacy manifest and permission strings in `app.config.ts`.
