# Final production readiness: October 2026

**Recommendation: NO-GO.** Do not submit the iOS app, start a Google Play
listing, or announce the website yet.

The code is in good shape, and this branch makes `main`'s suites green again.
What fails is **production as it actually runs**, and the store build. Four
critical blockers and eight high-severity issues are open. All four critical
ones are owner actions (settings, secrets, data), not code. Each is listed in
order in [the path to GO](#the-path-to-go).

_Audited 2026-10-15 and re-verified 2026-10-22 against `main` @ `bc2408d`,
which is what production serves (Vercel `dpl_7SQqFkdC…`, READY). This branch
(PR #43) adds the fixes in §3 on top. Evidence
is either reproduced here or read from production through the Vercel and
GitHub connectors. Anything that could not be checked is marked
**unverified**, not assumed. The Supabase connector failed to connect, and the
sandbox cannot reach `www.brokersconnect.net` directly._

---

## 1. Critical: release blockers

| # | Blocker | Evidence | Fix (owner) |
|---|---|---|---|
| **C1** | **`SUPABASE_SERVICE_ROLE_KEY` is not set on production.** Several things are broken live because of it: account deletion answers "unavailable" (App Store 5.1.1(v), Google Play's deletion policy, and the privacy policy all need it); employers cannot open applicants' CVs, which is the core loop; transactional emails and pushes are not sent; and the crons fail. | Vercel lists 8 production variables, and this is not one of them. Vercel runtime errors show `[cron] lifecycle cannot run: SUPABASE_SERVICE_ROLE_KEY is not configured` **every day from 2026-09-28 to 2026-10-22**. `/api/health` → `{"status":"degraded"}` on 10-15 and on 10-22. In the code, `deleteMyAccount` (`src/lib/actions/account.ts`) and `signedUrl` (`src/lib/storage.ts`) stop without the key. | Set the key on Vercel (Production) and redeploy. Apply any of 346–349 still missing (H4). Then confirm with an operator call to `/api/health` (bearer `CRON_SECRET`) that `serviceRole` is accepted and the `jobs` are fresh. |
| **C2** | **Demo accounts with a published password, one of them an admin, are probably still live on production.** Their companies are. `password123` is in this public repository's history permanently. The console requires MFA, but the database only demands a second factor from admins who have *enrolled* (migration 311). A never-enrolled demo admin can therefore call the admin RPCs and PostgREST directly with the password, and read every applicant's name, number and CV. | `docs/recovery-runbook.md` §5: confirmed valid on all 15 accounts, admin included, on 2026-09-27. All 7 demo companies (`aaaaaaaa-…-000000000001…7`) still have live listings on 10-22 (C3), so `pnpm remove-demo` was never run. Whether the passwords were rotated is **unverified**. Testing a credential against production is the owner's call, not an auditor's. | Create the real admin and enrol TOTP. Then `pnpm remove-demo` (dry run), then `--execute --confirm hiwdhicwsohbipxzazmb`, and revoke the demo sessions (`docs/recovery-runbook.md` §5). Check Supabase Auth logs for sign-ins to `@demo.test` since 2026-08, and ask a lawyer whether PDPL notification applies. |
| **C3** | **Every job on the public board is fake.** All 14 live listings belong to the seeded demo companies. Production was re-seeded about 2026-10-04: every `published_at` shares one seed run's fractional second, and the 10-02 audit had found these listings expired. People are applying to jobs that do not exist, a misleading-claim problem under Egypt's Consumer Protection Law (`docs/legal.md`) and a likely App Review rejection. | `GET /api/mobile/v1/jobs` on the production deployment, 10-15 and 10-22: `total: 14`, and every `company_id` is a demo company. | Fixed together with C2. The board is then **empty** until real companies post, and App Review tends to reject an app that opens empty (4.2). So get real listings live and approved first (`docs/app-store.md`, "Before the first submission"). |
| **C4** | **No backup of production exists.** Supabase Free keeps no restorable backups, and none of Storage. The nightly `DR backup` workflow has been **green 25 of 25 times while skipping every step**, because its secrets were never set. No restore has been rehearsed against production data, so a bad migration, a takeover (C2) or a mistaken delete is unrecoverable today. | GitHub Actions: each run's job skips every step after `Configured?` (run 25, 10-22, included). `docs/disaster-recovery.md`: "Supabase Free … None usable"; "Storage backup: None". | Set the eight `DR_*` secrets, run `DR backup` by hand, and check that the object landed. Before real users, move to Pro with PITR (options C/D in that document). Rehearse a restore (`pnpm dr:rehearse`) and record it. |

## 2. High

| # | Issue | Evidence | Fix |
|---|---|---|---|
| H1 | **The store build's own check is red, and the likeliest reason is that the board's job cards are not in the accessibility tree.** `iOS screens` builds the app as the App Store gets it (Release) and fails 3 of its 4 passes (store, dark, large text) on the board. Maestro reads the header, chips and tab bar, but no card, while macOS reads the cards' words off the same pixels. In a real build on iOS 18+, cards go through `ZoomLink` → `<Link asChild><Link.AppleZoom>` around a card drawn *without* its own press (`mobile/src/components/jobs/job-card.tsx`, `zoom-link.tsx`). Expo Go and Jest take the fallback path, so neither can see this. **Hypothesis, unverified on a device:** VoiceOver users cannot reach a listing, and taps may be affected too. Nothing has ever been tested on a real device or a store build (`HANDOFF.md`, open item 8). | Run 36 on `126ed50` (10-19), the last run. The iPad pass, which checks by OCR, passed. | Reproduce on a simulator build. Make the zoomed card expose its label and press, and re-run `iOS screens` until all four passes are green. |
| H2 | **Bot and abuse protection is configured but not switched on.** There is no Turnstile or CAPTCHA, no Vercel Firewall rules, no `SECURITY_SALT`, and no leaked-password protection. Sign-in brute force is bounded only by Supabase's defaults. | Vercel has no `TURNSTILE_*` or `SECURITY_SALT` variables. The firewall API answers "config not found". The live CSP carries no Turnstile origin. Leaked-password protection is listed as manual in `HANDOFF.md` item 4. | `docs/security/SECURITY_REPORT.md` §15, steps 2–3, and `SUPABASE_SETTINGS.md`. |
| H3 | **Nothing alerts anyone, so C1 has run for 25 days unnoticed.** There is no error tracking on the website, no crash reporting in the app, and no alert wired. `/api/health` answers **200** for "degraded", so an uptime monitor stays green. Production's Supabase logs have never been reviewed (`HANDOFF.md` item 3). | `grep` finds no Sentry or similar in `src/` or `mobile/src`. `RUNBOOKS.md` §D lists alerts as "documented". | Add an uptime monitor that alerts on **"degraded" as well as 503**, and Vercel alerts on 5xx and runtime errors. Add web error tracking and app crash reporting, and update the privacy label and policy when you do. |
| H4 | **Admin hygiene and migration state are unverified.** It is unknown whether a real admin exists with TOTP enrolled, and whether TOTP is on in Supabase Auth. 350–351 were applied to production on 10-19 through the Supabase connector (their commits say so). Whether 346–349, which waited for C1, were applied is unknown. | Supabase connector unavailable. | `pnpm db:apply` (dry run) lists what is missing. Every admin enrols at `/dashboard/account`. |
| H5 | **Legal is not finished.** No lawyer has reviewed the privacy policy, terms, cookies or deletion pages. The operator's street address and commercial registration are missing (`src/lib/business.ts`). The PDPL questions (transfer abroad to Supabase in Mumbai, Vercel and Resend; a local representative; legal bases) are open. | `docs/legal.md` and `docs/privacy/AUDIT-2026-09-27.md`. | The owner's lawyer. |
| H6 | **The Apple prerequisites are not in place.** There is no paid Apple Developer membership, and EAS holds no iOS credentials. `eas.json` has no `ascAppId` or `appleTeamId`. No iOS build has ever been made. `APPLE_APP_ID` is unset, so the app-site association is a 404. The Apple revocation keys and the Sign in with Apple provider are not set, and until they are, the iPhone app deliberately shows **no** social sign-in. | `HANDOFF.md` item 6. Production `/.well-known/apple-app-site-association` → 404. Vercel has no `APPLE_*` variables. | `docs/app-store.md`, "Before the first submission". |
| H7 | **How changes reach users skips review.** Around 18,800 lines of app work, and migrations 350–351, went **straight to `main` without a pull request** between 10-16 and 10-19. Each push to `main` deploys the website and auto-publishes an Expo Go update. `Web` CI on `main` has been **red since `62f62df` (10-19)**, and nobody acted on it (fixed on this branch, §3). Production migrations were applied through the connector rather than `pnpm db:apply`'s ledger. | `git log 90d70f9..bc2408d`, and the Web runs 133–136. | Protect `main`: require a PR and green `Web`, `End to end`, `Mobile` and `iOS screens`. Apply migrations with `pnpm db:apply`. |
| H8 | **The board will be empty after C3.** It is listed apart from C3 because fixing it is a business task, not a technical one: real companies posting real listings, approved in `/admin`. | — | Before the store submission and before the public announcement. |

## 3. Fixed on this branch

| Commit | What | Evidence |
|---|---|---|
| `7abac4c` | **Dependency advisories.** `next` 15.5.24 → **15.5.27** (two cache-poisoning advisories, GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p). `source-map-js` held at ≥ **1.2.2** by an override beside postcss's and sharp's (an event-loop DoS reported high, GHSA-68fv-2mgg-jv7q). Both releases are over two weeks old. The licence notices are regenerated. | `pnpm audit --prod`: 3 → **0**. The build passes on 15.5.27. E2E run 54 green. |
| `2ff48ee` | **Three unused native packages removed** (M3, formerly open). `react-native-maps`, `expo-calendar` and `react-native-qrcode-svg` were imported nowhere, and `expo-calendar`'s plugin wrote calendar permission strings into the app for a feature that does not exist. 17 lockfile entries go; nothing is added or changes version. | App `pnpm check`: 68 suites, 1,103 tests, 0 failed. |
| `641cdef` | **`DR backup` fails when unconfigured** (M2, formerly open). It names the missing secrets instead of passing quietly. `DR_BACKUP_DISABLED=true` turns it off on purpose. **From the next nightly run, `main` shows a red `DR backup` until C4 is done.** | The gate was run in all three states. |
| `40dfc17` | **README "Known gaps"** (L2, formerly open): the legal pages, the English switch, dark mode and Paymob, as the code has them now. | Each claim checked against its code. |
| `d7cabaa` | **`main`'s database suites run again.** Migration 350 rightly revoked anon's `EXECUTE` on `my_company_id()`. Built from the migrations, no policy or view calls it, and its nine callers are all `SECURITY DEFINER`. But `schema.test.mjs` still pinned it as anon-callable. That suite runs first in the `&&`-chained `test:db`, so since 10-19 **every database suite after it had not run on `main`**. Running them exposed a second stale test: migration 351 (withdrawing an application removes the candidate's notices about it) claimed to be tested in `notifications.test.mjs`, but that suite still expected the old behaviour. Both tests now assert what production does, and 351 gains checks of its own. | Reproduced: `schema.test.mjs` 29/30 without the fix, 30/30 with it. `pnpm test:db`: **23 suites, 2,051 checks, 0 failed.** |

## 4. Medium and low

| # | Sev. | Issue | State |
|---|---|---|---|
| M1 | Medium | The app's `pnpm audit --prod` reports 7 (1 critical `shell-quote`, 3 high). All of them sit in build and dev tooling (Expo CLI, Metro, React DevTools, Jest), not in the shipped bundle. | Open. Take the next Expo SDK patch. |
| M4 | Medium | Uploaded CVs and documents get no malware scanning. The type is checked and images are re-encoded. | Accepted risk (`SECURITY_REPORT.md` §12). |
| M5 | Medium | Google Play is not started: no Firebase or FCM, no `ANDROID_CERT_SHA256`, no Play submit profile. | Open (`docs/app-store.md`, "Android"). |
| M6 | Medium | Saved-job notes and reminders live only on the phone, so they are lost on reinstall or a new phone (`HANDOFF.md` item 5). | Product decision. Say so in the app. |
| L1 | Low | Two routes are over the performance budget: `/dashboard/profile` is 230.6 KB against 230, and `/employer/applicants` is 161.1 KB against 160. The applicants page has grown by about 20 KB since the budget was set, at 137–141 KB. CI does not run `perf:budget`. | Open. |
| L3 | Info | The runtime error "Failed to find Server Action" (24 in 30 days) comes from scanners posting to `/index.php`. | No action. |

## 5. Completed improvements (the previous tasks)

The previous rounds, verified as present on `main` and covered by the suites in §6:

- **Security hardening (#13):** 22 findings fixed in migrations 303–313. Contact details are revealed on request, with limits and a ledger. Suspension revokes access. Server-owned columns are enforced. Path traversal and `javascript:` URLs are refused. Upload bytes are sniffed and images re-encoded. Payment settlement is bound to its signed fields. Admin AAL2 is required once an admin enrols. API roles have statement timeouts. Later: 344 (doors a review found open) and 350 (`my_company_id` closed to anon).
- **Privacy:**
  - Consent to the Terms and the Privacy policy, plus an 18+ confirmation, recorded per version (336).
  - Directory cards hidden by default, with an explicit choice (336).
  - Retention as the policy states it (338).
  - Private suspension reasons (327).
  - The directory is for employers only (322).
  - Neutral consultant slugs (202).
- **Moderation and safety (#28):** reports kept as evidence, moderator signals, appeals, decisions notified (331, 345–349).
- **Operations:** an email outbox with retries and dead letters, scheduled jobs with leases and a run log, support references, the admin console with an append-only audit log, and lifecycle and integrity tooling.
- **Release engineering (#17 and the reconciliation):** a migration linter, ledger-based `db:apply`, and a rehearsal against production's real order. Production was brought up to `main` on 09-29 and 10-07.
- **Other rounds:** SEO, Arabic search, accessibility, cross-browser QA, performance (functions in `bom1`), and the data-quality and taxonomy audits.
- **The iOS app (#29, #33 and the 10-08 to 10-19 work):** the Expo SDK 57 app and `/api/mobile/v1`; Sign in with Apple; pushes; the store listing as code; review accounts; the privacy manifest; the legal pages; and the 10-19 hardening of hangs, CV upload fallbacks, sign-out, push registration and RTL sheets.

## 6. Test results and evidence

| Check | Result | Where |
|---|---|---|
| `pnpm check` (typecheck, messages, licences, legal, unit, release rehearsal, all database suites on the real migrations, concurrency) | **61 suites, 3,257 checks, 0 failed** on this branch. On `main` `bc2408d` it stops at the database suites (§3). | Run here, 10-22 |
| `pnpm test:db` | **23 suites, 2,051 checks, 0 failed** | Run here, 10-22 |
| Authentication (redirect safety, session recovery, second factor, Apple revoke, confirm links) | Pass, within `pnpm check` | Run here |
| Security (RLS as every role, tenant isolation, suspension, reveal limits, storage, admin AAL2) | Pass: `policies`, `security`, `doors`, `security-libs` | Run here |
| `pnpm build` | **Pass** (Next 15.5.27, 60 static pages) | Run here |
| App `pnpm check` (typecheck, lint, shared code, OTA checks, licences, Jest) | **68 suites, 1,103 tests, 0 failed** | Run here, 10-22 |
| End to end (local Supabase stack, built site: browse → candidate signs in → save → apply with CV → employer works it → employer posts → sign up, onboard, delete → protected doors; plus the mobile-API smoke) | **Pass**: run 54 on this branch (10-16). Re-run on the rebased head `d7cabaa`: **pass** (run 68, 10-22). `main`: pass (run 60, 10-19). | GitHub Actions |
| Store build on iOS simulators (`iOS screens`) | **Fail**, 3 of 4 passes (H1) | GitHub Actions run 36 |
| Expo Go tour | Failing on `main` (runs 85, 87) | GitHub Actions |
| Dependency audit | Web **0** on this branch. App 7, tooling only (M1) | `pnpm audit --prod` |
| Performance budget | 14 of 16 within; 2 over by ≤ 1.1 KB (L1) | `pnpm perf:budget` |
| Production `/api/health` | **200 `degraded`** (10-15 and 10-22) | Production deployment |
| Production security headers | CSP (`frame-ancestors 'none'`, `object-src 'none'`), HSTS two years with subdomains, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies: all present | Production deployment |
| Production runtime errors (7 days) | The lifecycle cron, daily (C1); scanner noise (L3) | Vercel |
| Load and abuse tests (`load/k6`) | **Not run.** No staging stack exists | — |
| A real device or a TestFlight build | **Never** (`HANDOFF.md` item 8) | — |

## 7. Security and privacy status

**Code and schema: ready.** RLS covers every table. Role and tenant isolation
and suspension are tested, and the database suites run again. CVs are reached
only through five-minute signed URLs. Contact details are revealed only on
request, with limits. Uploads are verified, and the security headers are live.

**Production: not secure.** These are the open items:

- possible admin access with a public password (C2);
- no backups (C4);
- no CAPTCHA, firewall, salt or leaked-password check (H2);
- no monitoring (H3).

The privacy policy also promises three things production cannot do today
(C1): self-service deletion, an employer seeing an applicant's CV, and
twelve-month deletion of files (the storage cleanup is the failing cron).

## 8. Production build status

The build passes and typecheck is clean. Production runs `main` @ `bc2408d`
with Vercel functions in `bom1` beside the database. The configuration is
**incomplete**: production has 8 environment variables, and
`SUPABASE_SERVICE_ROLE_KEY`, `SECURITY_SALT`, the Turnstile pair,
`RESEND_WEBHOOK_SECRET`, `APPLE_APP_ID`, the Apple revocation values and
`MOBILE_APP_STORE_URL` are all absent.

## 9. Store readiness

**App Store: not ready.**

- **Done in code:** the bundle id `net.brokersconnect.app`, version 1.0.0, the
  privacy manifest (no tracking), export compliance, the listing as code, the
  18+ rating, review-account tooling, and the screenshot pipeline.
- **Blocking:**
  - deletion does not work (C1);
  - the board is fake, then empty (C3, H8);
  - the store build's check is red (H1);
  - there is no Apple account, no credentials and no build (H6);
  - the legal review is not done (H5).

**Google Play: not started** (M5).

## 10. Recovery arrangements

**Rollback of the website: available.** Vercel keeps the previous production
deployments as rollback candidates.

**Rollback of the app: designed, but unproven.** The app uses OTA updates
with fingerprint runtime versions, and `MOBILE_MIN_APP_VERSION` can force an
update. No store build exists to prove it on.

**Database recovery: not possible today** (C4). The runbooks are written
(`docs/recovery-runbook.md`, `docs/disaster-recovery.md`, `RUNBOOKS.md`),
but there is nothing to restore from.

## The path to GO

1. **Lock production down:** create the real admin and enrol TOTP, then
   `pnpm remove-demo --execute --confirm hiwdhicwsohbipxzazmb`. Review the
   Auth logs for demo sign-ins. (C2, C3, H4)
2. **Take a backup now:** set the `DR_*` secrets, run `DR backup` by hand, and
   check that it landed. Once PR #43 is merged, the workflow stays red until
   this is done. Choose a plan with PITR before launch. (C4)
3. **Set the server keys** on Vercel (Production): `SUPABASE_SERVICE_ROLE_KEY`,
   then `SECURITY_SALT`, `RESEND_WEBHOOK_SECRET`, and the Turnstile pair.
   Then redeploy and `pnpm db:apply`. Confirm `/api/health` says **ok** and
   the crons stay green for 24 hours. (C1, H4)
4. **Merge this branch** (green `main`, Next 15.5.27). Protect `main`. (H7)
5. **Turn the defences on:** CAPTCHA, leaked-password protection, the
   firewall, and alerts on "degraded", 5xx and runtime errors. Add error and
   crash tracking. (H2, H3)
6. **Fix the store build** until `iOS screens` is green on all four passes. (H1)
7. **Real listings, the lawyer, then Apple:** membership, credentials, a
   TestFlight build on a real iPhone through `docs/mobile.md`'s checklist,
   then submission. (H5, H6, H8)
8. Re-run this audit. **GO** when §1 and §2 are empty, CI is green on `main`,
   and `/api/health` says `ok`.
