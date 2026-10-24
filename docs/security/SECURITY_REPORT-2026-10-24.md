# Brokers Connect: security review and hardening, 2026-10-24

Website (`src/`), iPhone app (`mobile/`), Supabase schema (migrations to 371), CI and supply chain, and the production settings readable from here. Branch `claude/brokers-connect-security-yqhcop`. It builds on `SECURITY_REPORT.md` (September), `AUTH_AUDIT-2026-10-16.md`, `DATABASE_AUDIT_2026-10.md` and `MOBILE_AUDIT-2026-10.md`. What those found and fixed was re-checked and still holds; it is not repeated here.

## 1. Verdict

**NOT SECURITY READY FOR PRODUCTION.**

The code and schema on this branch are ready. Production is not, for three reasons.

1. **Production runs code with a published high-severity advisory**: `next` 15.5.27, Server Actions CPU DoS (GHSA-p3m5-59mp-jv5r, no workaround). The fix and six migrations are on this branch, not deployed.
2. **Two older Vercel apps hold production-grade secrets on public URLs.**
   - `careers-brokersconnect` serves `careers.brokersconnect.net` from v0-generated code that is in neither repository. It holds a service-role key, the JWT secret and the database password.
   - The old `brokersconnect` project still serves a commit with an unauthenticated admin-creation route.

   Until you confirm which Supabase project they point at, they are an unreviewed back door (finding 1).
3. **The defences that need a dashboard are still off.**
   - Turnstile keys and CAPTCHA.
   - `SECURITY_SALT`.
   - Firewall rules and bot protection (never saved: the firewall API answers 404).
   - Leaked-password protection.
   - An uptime alert.
   - PITR and a restore rehearsal (unknown or not done).

Every item that is left is yours to do, from a dashboard, and none of them needs more code. §6 lists them in order, each with its time. When rows 1–12 of §6 are done and `PRODUCTION_GATE-2026-10-24.md` reads Done on every row, the verdict becomes **SECURITY READY FOR PRODUCTION**.

## 2. Findings

Severity is the harm to a real person. A commit hash means fixed on this branch, with a test that failed before the fix (one-line items excepted).

| # | Sev. | Area | Finding | Evidence | Fix / owner |
|---|---|---|---|---|---|
| 1 | **High** | Old deployments | `careers-brokersconnect` (Vercel, v0-generated, source in neither repo) serves the public custom domain `careers.brokersconnect.net`. It holds `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` and `POSTGRES_PASSWORD`; Vercel flags four of them `readable-secret`. Code nobody has reviewed, holding keys that bypass RLS. The old `brokersconnect` project's production deployment is commit `fc4c4ac`, which has an unauthenticated `POST /api/admin/create-test-user`. That route creates a confirmed user for `kirolosedward1@gmail.com` with a hardcoded password, through the service role. That project has no service-role variable set, so the route should fail, but it is live code. | Vercel API: both projects' env names and latest deployments; the old repo at `fc4c4ac`. | **Owner**: §6 step 1: find which Supabase project each points at, then delete or disable both projects (and the `v0-brokers-connect-1st-oct` project, whose last build errored). If either points at `hiwdhicwsohbipxzazmb`, rotate per §4. |
| 2 | **High** | Dependencies | Production runs `next` 15.5.27: GHSA-p3m5-59mp-jv5r (Server Actions CPU DoS, no workaround) and GHSA-2464-fhr4-w9xw (critical, RCE via image optimisation). The critical one is already closed by `sharp` 0.35.5 (the advisory's own workaround), which the lockfile resolves. | `pnpm audit` | Branch `63e27d10`: `next` 15.5.28. |
| 3 | **Medium** | Email abuse | An employer holding an application could loop it `rejected ↔ shortlisted` through `setApplicationStatus`. Each round sent the candidate a branded email carrying the employer's own 500-character note, plus a bell and a push, without limit: the platform's sender as a relay against one person. | `notices.test.mjs`: 10 rounds rang 20 times. | `4ff14484`: migration 365 plus `MAX_STAGE_TELLINGS` in `notify.ts`. |
| 4 | **Medium** | Data exposure | After a withdrawal (kept since 362), the employer kept reading the person's profile, WhatsApp number included, for good: in the inbox's RSC payload and straight from PostgREST. `profiles_select_applicants` matched withdrawn applications. | `withdrawn.test.mjs` failed before. | `5bb7610f`: migration 366. |
| 5 | **Medium** | Admin | `admin_set_role` could make new admins from an aal1 (password-only) session when the acting admin had no authenticator (allowed while `ADMIN_MFA_REQUIRED` is unset). One stolen password could become admins that outlive a password reset. | `admin.test.mjs` failed before. | `63fd0e92`: migration 367 (promotion needs aal2; demotion does not, for RUNBOOKS A2). |
| 6 | **Medium** | Payments | The Paymob webhook read its HMAC secret raw. An unedited `REPLACE_ME` from the env template is a known string, and a callback signed with it was accepted (200). An employer knows their own order id, amount and currency, which is everything `settle_order` checks, so that meant credits without paying once billing is on. | `paymob-webhook.test.mjs` got 200. | `31dfbfcb`: `configuredValue()`. |
| 7 | **Medium** | Data exposure | `companies_select_public` (`using (true)`) gave anybody, anon included, every company's `owner_id`, `post_credits` and `suspension_reason`. `GET /api/mobile/v1/companies` returned the same through the CDN. `/jobs/<slug>` hid them by a deny-list and still sent the job's `idempotency_key`. | `security.test.mjs`, `strangers.test.mjs`, `mobile-api.test.mjs` (failed before). | `c0cefb0c` (`COMPANY_PUBLIC_COLUMNS` / `PublicCompanyRow` for every public read); `c0c7fe84` and `f2d32d59` (369: the readers' functions; 371: column privileges; callers on both clients moved); `c998e272`. **Apply 371 only after the code**: §5. |
| 8 | **Low** | Abuse | `recordJobView` is a public action of the site and of the app's door. It called `increment_job_view` with the service role, unthrottled, so a signed-out loop inflated view counts. Migration 304 closed that function to anon for exactly this. | `mobile-api.test.mjs` | `ae6162a7`. |
| 9 | **Low** | CSRF | `/api/agent-cv`, `/api/cv` and `/api/account/export` spend something on a GET under the cookie. Another site could navigate a signed-in recruiter there and use up their reveals, writing a ledger row the consultant sees. | `security-libs.test.mjs` | `3ef0f75b`: `Sec-Fetch-Site` cross-site and same-site refused in `withOptionalBearer`. |
| 10 | **Low** | Integrity | `application_notes_delete` checked only the author, and an unfiltered DELETE never applies the select policy. So a suspended author, or one who had left the company, could erase the team's notes. | `policies.test.mjs` deleted 1. | `3247d844`: migration 368. |
| 11 | **Low** | App | An admin demoted on the same session kept the console's cached reads in memory, because the summary stays mounted with no garbage collection. | `admin-demotion.test.tsx` | `8e88114e`: `SessionProvider` drops `admin` and `admin-door` queries on a confirmed non-admin role. |
| 12 | **Low** | App privacy | The crash log kept server and database error text (addresses, numbers, file names, signed URLs) word for word. It survived sign-out and deletion, and the next person on the phone was offered it to send. | `crash-log.test.ts`, `session.test.ts` | `d60de93a`: the website's scrubber (`telemetry/scrub.ts`) on every line; `forgetCrashLog()` on sign-out. |
| 13 | **Low** | App privacy | Deleting an account left the phone's hidden lists, including the names of consultants an employer had hidden. | `auth.test.tsx`, `hidden-store.test.tsx` | `cfa43350`: `forgetHiddenOnThisPhone()` on deletion. |
| 14 | **Low** | Monitoring | The lifecycle job (privacy retention and file deletion) logged only failures and wrote no `job_runs` row. A night it never ran looked like a clean night. Production's last day of logs shows every other job and nothing for this one. | Vercel runtime logs; `security-libs.test.mjs` | `91ee9c49`: through `runScheduledJob`; `/api/health` flags it after 26 h. |
| 15 | **Low** | Content | A blog slug was joined into a file path: `../legal/privacy` was served as a post. Repository markdown only. | `blog-slug.test.mjs` | `ffc60f24` (also `safeHttpUrl` on the admin company page). |
| 16 | **Low** | Monitoring | Critical security events reached nobody (RUNBOOKS §D: "none are emitted… wire a webhook"), and a new admin was not an event at all. | – | `fb9b4db2`: migration 370 and `/api/cron/security-watch`. An email to every admin within 10 minutes; the Monday digest. |
| 17 | **Low** | Headers | Live: no COOP, HSTS without `preload`, `X-Powered-By` sent. | Live response headers | `01cf50e1`: COOP `same-origin-allow-popups`, `preload`, `poweredByHeader: false`; checked on a local production build. |
| 18 | **Low** | Auth | Forms required 8 characters, not the 10 recommended. Sign-in also enforced length, so raising it would have locked out older passwords. | – | `1291f195`: `NEW_PASSWORD_MIN = 10` for new passwords on both clients; sign-in checks none; messages say 10. Server setting: §6. |
| 19 | **Low** | Supply chain | No secret scan, audit gate or CodeQL in CI. Actions pinned by tag. No Dependabot. No check that a client bundle holds no server secret. | – | `2d7100b0`, `60b9735a`, `af938cfe`, `d38d2762`, `283818da`, `247fb95e`: `security.yml` (gitleaks over all history with a reviewed baseline, `pnpm audit` at high for both roots with named exceptions, CodeQL); SHA pins; `dependabot.yml`; `bundle-secrets.mjs` in `web.yml` and `mobile.yml`; `fast-uri` 3.1.9. |
| 20 | **Low** | App | Four packages imported nowhere (`react-hook-form`, `@hookform/resolvers`, `expo-device`, `expo-store-review`). HANDOFF item 7's three were already gone. | – | `40e22836`. |
| 21 | **Info** | App | Updates were unsigned. | – | `a87f37f3`: code signing switches on when `mobile/certs/certificate.pem` is committed; the publish script requires the key's path. Steps: `docs/mobile.md`, "Signed updates". Key generation is yours (§6). |

All 40 `admin_*` database functions now refuse a candidate, an employer and a visitor, held by one test that reads them from the schema (`admin.test.mjs`). It caught the two functions this branch had added answering empty instead of refusing.

### Accepted or left, with the reason

- **CSP `'unsafe-inline'` for scripts.** Nonces need every page rendered per request. This site serves 60 static and ISR pages, and Next's inline bootstrap differs per page, so hashes cannot work either. The other CSP directives (`object-src`, `base-uri`, `form-action`, `frame-ancestors`) and output escaping are the control. Revisit if pages go dynamic.
- **Upload checks fail open when the storage check itself cannot run** (`verifyStoredObject` `unavailable`). This is deliberate: a storage blip must not lose a real application. An attacker cannot force it, and production has had the service-role key since 2026-10-22. Files stay in private buckets behind five-minute signed URLs.
- **Push token takeover** (`register_push_device` moves a token to whoever presents it). Knowing a token requires the victim's phone or Expo's servers. Turn on Expo's *Enhanced Security for Push Notifications* (§6).
- **Avatar and logo URL guards accept any https host** (migrations 344 and 352). Both clients only draw this project's storage URLs (`trustedAvatarUrl`, `trustedLogoUrl`).
- **`saved_jobs` owner update is whole-row.** It exposes nothing new (the insert could already name any job). Column grants would be the fix, but the harness re-grants after migrations; 371 shows the pattern if it is wanted.
- **Directory paging has no per-user counter.** Only approved employers reach it, the cards are anonymised, and contact goes through the counted `reveal_agent_contact`. The edge firewall rules cover it once applied.
- **Employer decision notes may contain links**, sent in the platform's emails. Capped to three tellings per stage (finding 3), escaped. Stripping links would change what a recruiter can say.
- **zod GHSA-mrhx-c7xc-m3w5** has no zod-3 fix, and every array schema is bounded. **node-forge GHSA-86w9-cpqp-85rv** is in the Expo CLI at build time, with no fix yet. Both are named in `auditConfig.ignoreGhsas`.
- **Not run: `load/k6/abuse.js`.** It needs a preview wired to a Supabase branch, which this session could not create or reach. Never against production (§6 step 12).
- **Malware scanning of uploads.** Unchanged since September (SECURITY_REPORT §12).

## 3. Production gate

Full table with evidence and the two-minute checks: `docs/security/PRODUCTION_GATE-2026-10-24.md`. Summary:

| Item | State |
|---|---|
| `CRON_SECRET` (Prod + Preview) | Done |
| `SECURITY_SALT` | **Not done** |
| Turnstile keys and Supabase CAPTCHA | **Not done** |
| Paymob HMAC, integration and iframe ids | **Not done** (billing cannot settle; it fails closed) |
| Leaked-password protection | **Not done** (advisor, 2026-10-22) |
| Minimum password 10 | Forms done (branch); server **Unknown** |
| Email confirmation, auth rate limits, session time box, secure password change, redirect allow list | **Unknown** (checks given) |
| TOTP enabled; every admin enrolled | Done (one admin, enrolled); confirm with the SQL given |
| Vercel firewall rules, Bot Protection, managed ruleset | **Not done** (firewall config 404) |
| Alerts | Security alerts built (branch); uptime, 5xx and DB-CPU alerts **Not done** |
| PITR, storage versioning | **Unknown** |
| Restore rehearsal | **Not done** |
| Retention jobs running | Partly shown; recorded from this branch on |
| Live headers | Done, plus COOP and preload on the branch |
| `/api/health` public detail | Done (one word to the public) |
| Source maps | Done (none emitted) |
| Git fork protection | Done |
| Old Vercel apps with secrets | **Action needed** (finding 1) |

## 4. Secret scan and rotation

**Scan.** Full history of both repositories. `brokersconnectcareers`: 963 commits on 79 branches, unshallowed. `brokersconnect`: 9 commits on 2 branches. Two tools: gitleaks 8.28.0 (checksum verified), and a pass over every blob in history for the types you listed. Those are Supabase secret and service-role JWT, database URLs with a password, PEM private keys, Resend, Svix, Turnstile secret, Google, Expo tokens, Paymob, `CRON_SECRET`, VAPID and GitHub tokens. No value was printed.

| Repo | Commit | File | Type | Verdict |
|---|---|---|---|---|
| careers | `189b5076`, `4596082d` | `scripts/email-log.test.mjs` | JWT (`role: service_role`) | Test fixture: 13-character signature, no project ref. It tests that secrets are scrubbed. |
| careers | several | `scripts/email-log.test.mjs` | `sb_secret_this…` | Fixture string. |
| careers | `774291f1`, `5aba11b1` | `.github/workflows/*.yml`, `mobile/eas.json`, `mobile/.env.example` | `sb_publishable_…` | Publishable key, public by design. |
| careers | various | `mobile/tests/*`, `supabase/tests/*`, `scripts/*` | generic-api-key | Test constants (storage keys, token hashes, UUIDs). |
| careers | `56c6221a`, `23156693`, `04b879cc` | `scripts/db-push.mjs`, `scripts/db-rehearse.mjs`, `scripts/release/apply.test.mjs` | DB URL | Placeholders (`PASSWORD@db.REF`) and local `127.0.0.1`. |
| **old** | `d08643dd` | `lib/actions/create-admin.ts` | **Hardcoded password** (account `kirolosedward1@gmail.com`) | **Real-looking.** |
| **old** | `fc4c4ac9` | `scripts/create-test-user.mjs`, `app/api/admin/create-test-user/route.ts` | **Hardcoded password** (same account, a different one) | **Real-looking.** |

The reviewed fixtures are the baseline in `.github/gitleaks-baseline.json` (redacted). CI fails on anything new.

**Rotation checklist** (yours; never paste a secret into a chat):

1. **The two passwords in the old repo.** Treat both as known to anybody who ever saw that repository.
   - If either was ever the password of `kirolosedward1@gmail.com` anywhere (Google, Supabase, Vercel, Expo, GitHub, the platform itself), change it there now and turn on two-step sign-in.
   - In the platform: Supabase → Authentication → Users → find `kirolosedward1@gmail.com` (in each project, old and new) → *Send password recovery*, or delete the user if it was only a test account.
   - Then remove the files from the old repo's history, or archive the repository.
2. **Only if finding 1 shows an old app points at production `hiwdhicwsohbipxzazmb`** (RUNBOOKS A3 and A4):
   1. Supabase → Project Settings → API Keys → create a new secret key, and **disable the legacy JWT-based keys** (`anon` and `service_role`). The website and app use the new `sb_publishable_` / `sb_secret_` keys, so this cuts off anything still holding a legacy key.
   2. Set the new key as `SUPABASE_SERVICE_ROLE_KEY` on Vercel `brokersconnectcareers`, Production and Preview, then redeploy.
   3. Database → Settings → *Reset database password*. `DATABASE_URL` is used only by local scripts and GitHub's `DR_DATABASE_URL` secret, so update that secret.
   4. JWT secret: Project Settings → JWT Keys → rotate. This signs everyone out once.
   5. `/api/health` with the cron secret should then report `serviceRole` ok.
3. **Nothing else was ever committed.** No rotation is owed for Paymob, Resend/Svix, Turnstile, Apple `.p8`, Expo tokens, Google keys, VAPID or `CRON_SECRET`.

**Making the repository private** is recommended. `HANDOFF.md` names the only admin's email address, and the docs map the levers, thresholds, firewall rules and runbooks. The Supabase project ref is not secret: the live CSP names it.

What changes if you make it private:

- **Vercel deploys**: keep working; the GitHub app has access.
- **EAS**: unaffected; it uploads from your machine or CI.
- **Anonymous clones**: nothing in the app or site fetches from GitHub.
- **Actions minutes**: start counting. The macOS jobs in `mobile.yml` and `ios-screens.yml` bill at 10×.
- **CodeQL and secret-scanning push protection**: free only on public repositories. On a private one, `security.yml`'s `codeql` job fails unless you buy GitHub Code Security. Delete that job, or keep it with the plan. The gitleaks and audit jobs keep working.

Settings → General → Danger Zone → *Change visibility*. Do it yourself; this session did not.

**If it must stay public**, move these into a private repository or a private docs space:

- `docs/security/` (all of it, `vercel-firewall.json` included)
- `docs/audit/`, `docs/release/`, `docs/prompts/`
- `load/`
- `HANDOFF.md`, or at least the admin's address in it

Then add the paths to `.gitignore`. They stay in history, so they are still readable at old commits; making the repository private is the only real fix.

## 5. Tests and deploy order

| | Before | After |
|---|---|---|
| Website `pnpm check` (typecheck, catalogue, every suite, `test:db` in PGlite, concurrency) | 3,932 checks, 0 failed | **4,112 checks, 0 failed** |
| App `pnpm check` (typecheck, lint, shared-code guard, update checks, licences, Jest) | 1,385 tests in 87 suites | **1,392 tests in 88 suites**, 0 failed |
| Production build | passes | passes; `bundle-secrets` clean on `.next/static` and on the app's JS export |

New suites: `strangers.test.mjs` (61), `paymob-webhook`, `bundle-secrets`, `security-alerts`, `blog-slug` and `admin-demotion`. Plus additions to `security`, `policies`, `admin`, `notices`, `withdrawn`, `lifecycle`, `moderation`, `security-libs`, `mobile-api`, `crash-log`, `session`, `auth`, `hidden-store` and `publish-update`.

**Deploy order** (`docs/release`; `pnpm db:apply`, never `db:push:url` against production):

1. Take a manual backup (RUNBOOKS §C).
2. `TARGET_DATABASE_URL=<session pooler> pnpm db:apply` shows what production is missing. Migrations 356–363 may be among them: HANDOFF records 346–349 and 352–355 as applied, and 363 waits for #75.
3. Apply **365, 366, 367, 368, 369 and 370**. All are additive or narrowing, and safe before the code.
4. Merge the branch; Vercel deploys. Publish the app's update (the `expo-go` workflow on main, or `pnpm run ota`).
5. After phones have had a day to take the update, apply **371**. A phone still on the old bundle reads its employer company with `select('*')` until it updates.
6. Send the test alert (RUNBOOKS §D).

## 6. Your action list, in order

| # | What | Time | Where |
|---|---|---|---|
| 1 | Find what the old apps point at, then remove them. Vercel → `careers-brokersconnect` → Settings → Environment Variables → reveal `SUPABASE_URL`: is the subdomain `hiwdhicwsohbipxzazmb`? Same for `brokersconnect`. Then Settings → Advanced → **Delete project** for `careers-brokersconnect`, `brokersconnect` and `v0-brokers-connect-1st-oct` (move the `careers.brokersconnect.net` domain first if you want it to redirect to www). If either pointed at production, do §4 step 2. | 10 min | vercel.com |
| 2 | Change the two old passwords wherever used (§4 step 1); archive or clean the old repo. | 10 min | Google, Supabase, GitHub |
| 3 | Merge this branch and apply migrations in the §5 order. | 30 min | GitHub, terminal |
| 4 | Set `SECURITY_SALT` (a long random string), `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` on Production and Preview. Optionally `SECURITY_ALERT_EMAIL` (your own inbox). Redeploy. | 10 min | Cloudflare → Turnstile (create a widget for `brokersconnect.net`); Vercel → Settings → Environment Variables |
| 5 | Supabase Auth: CAPTCHA = Turnstile with the same secret (after step 4); leaked-password protection on; minimum password length 10; confirm email on; secure password change on; rate limits per the gate; redirect allow list per gate row 12. | 10 min | Supabase → Authentication |
| 6 | Vercel Firewall: `VERCEL_TOKEN=… node scripts/vercel-firewall.mjs` (a token with the team scope); Bot Protection and the OWASP managed ruleset in Log mode for a week. | 15 min | Vercel → Firewall |
| 7 | Alerts: an uptime monitor on `https://www.brokersconnect.net/api/health` (503 three times); Vercel → Observability alert on 5xx > 2 %; Supabase → Reports alert on CPU > 80 %. Then send the test alert (RUNBOOKS §D) and write the date there. | 20 min | an uptime service, Vercel, Supabase |
| 8 | PITR on; storage versioning on for `cvs` and `company-documents`. | 5 min | Supabase → Database → Backups; Storage → Settings |
| 9 | Remove the demo data (below). | 15 min | terminal |
| 10 | Make the repository private, or move the files (§4). | 5 min | GitHub → Settings |
| 11 | Expo: two-step sign-in on the account; *Enhanced Security for Push Notifications* on; before the first store build, generate the update-signing key and commit the certificate (`docs/mobile.md`, "Signed updates"). | 15 min | expo.dev |
| 12 | One restore rehearsal to a new project or branch, recorded in RUNBOOKS §B; then `load/k6/abuse.js` against a preview wired to that branch. | 60–90 min | Supabase, Vercel preview |
| 13 | Set `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_IFRAME_ID` only when billing should take money. Until then set `BILLING_ENABLED` to `false`, so the buy button does not lead to a checkout that cannot complete. | 5 min | Paymob dashboard; Vercel |

**Demo data (step 9).** 14 demo listings are on the public board, and 4 real candidates applied to them, sending CVs to companies that do not exist. The demo accounts are banned (`banned_until` 2999), so nobody can sign in to read those applications now.

1. Before removing, check whether anybody read those CVs while the demo password was public. In the SQL editor: `select key, count(*) from rate_limit_hits where key in (select 'cv_download:user:' || id from auth.users where email like '%@demo.test') group by key;`. That table keeps only the recent window, so also look at Supabase → Logs → Storage for signed-URL reads in the `cvs` bucket since the applications were sent. If either shows reads, tell those 4 people exactly that.
2. Dry run, read-only: `NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… TARGET_DATABASE_URL=… pnpm remove-demo`. It prints the counts.
3. Remove: `… pnpm remove-demo --execute --confirm hiwdhicwsohbipxzazmb`. This deletes the demo companies, their listings, the 4 real applications (their CV copies are queued for deletion unless the candidate's profile still uses the same file), and the demo users.
4. Before running it, tell the 4 candidates. A message for you to send (Arabic first):

   > نعتذر: الإعلان الذي تقدّمت إليه على بروكرز كونكت كان إعلاناً تجريبياً لشركة غير حقيقية، وقد حذفناه. سنحذف طلبك ونسخة السيرة الذاتية المرفقة به. لم يطّلع أي صاحب عمل على طلبك. ملفك الشخصي وسيرتك الذاتية في حسابك كما هما، ويمكنك التقديم على الإعلانات الحقيقية في أي وقت.
   >
   > We're sorry: the listing you applied to on Brokers Connect was a demo for a company that does not exist, and we have removed it. Your application and the CV copy sent with it will be deleted; no employer saw it. Your profile and CV are unchanged, and you can apply to real listings any time.

   Get their addresses with: `select distinct u.email from applications a join jobs j on j.id = a.job_id join companies c on c.id = j.company_id join auth.users o on o.id = c.owner_id join auth.users u on u.id = a.candidate_id where o.email like '%@demo.test' and u.email not like '%@demo.test';`

   If step 1 found reads, change "no employer saw it" accordingly.
5. HANDOFF item 10: the admin's own public consultant profile (`consultant-33529768`). Hide it if it should not be listed.
