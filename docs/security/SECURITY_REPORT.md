# Brokers Connect — Security, anti-abuse, privacy and scale hardening: final report

_September 2026. Branch `claude/blissful-wright-cjgxbt`. Covers the audit of the platform as deployed and the changes in migrations 68–78 plus the application code that accompanies them._

**Verdict: NOT SECURITY READY FOR PRODUCTION — until the five operator actions in §14 are done.** The code, schema, tests and build are ready. What is outstanding cannot be done from a repository: dashboard settings on Supabase (Turnstile CAPTCHA, TOTP), environment variables and firewall rules on Vercel, alert wiring, and one rehearsed restore. Each is a short, specific task; together they are the difference between "the defences exist" and "the defences are on".

---

## 1. How the audit was done

Every file under `src/`, every one of the 67 migrations, both webhooks, the four cron jobs, the storage policies and the message catalogue were read. The final database state was dumped from the real migrations applied to an in-process Postgres (PGlite), so policies, function grants and triggers were reviewed as Postgres sees them, not as the files describe them. Two audit passes ran in parallel over the actions/queries and the schema; their findings are reconciled below. Production itself could not be reached from the sandbox (outbound HTTPS to the site is blocked; the Supabase MCP server failed to connect; the Vercel token lacked the project's team scope), so anything about live settings is stated as "documented, to be applied", never as verified.

The threat model, data classification and adversary table are in `THREAT_MODEL.md`.

## 2. What was already good

The starting point was well above average and shaped the approach: RLS on all 28 tables with deny-by-default; guard triggers that compare OLD to NEW for every privilege column; `SECURITY DEFINER` functions with pinned `search_path` and a test that pins which are anon-callable; `.select()` after every write; signed five-minute CV URLs; safe-redirect handling covering encodings and backslashes; Svix and Paymob signatures verified on raw bytes with constant-time comparison; an idempotent email outbox; one-company-per-owner and one-application-per-listing keys; a CSP with `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`; and a test culture that reads the source to keep rules from drifting.

## 3. Vulnerabilities found and fixed

Severity is the impact on a real person, not CVSS theatre.

| # | Sev. | Finding | Fix (migration / file) |
|---|---|---|---|
| 1 | **High** | `get_agent_card()` returned `whatsapp_phone` and `cv_path` for every `public` consultant to **anonymous** callers, and `search_agents()` gave the slug list; the profile page minted a CV link for whoever held the path. Whole-directory phone/CV harvest in one script, no session, no limit. | 69: contact removed from the card; `reveal_agent_contact()` (auth + good standing + company + visibility + per-user hour/day + per-company day allowances + advisory lock + ledger); directory functions closed to anon and served by the server; `/api/agent-cv` route; `ContactReveal` button (`agent-contact.ts`, `contact-reveal.tsx`) |
| 2 | **High** | Gated ("verified employers only") consultants were de-anonymised by their slug, which is their transliterated name, returned to everyone. | 69: locked cards are handled by their id everywhere; `get_agent_card`/`record_agent_view`/`reveal_agent_contact` accept either |
| 3 | **High** | `jobs` INSERT did not constrain `published_at`, `expires_at`, `featured_until`, `view_count`, `rejection_note`, `created_at`. An approved employer could plant a listing dated 2099 that, once approved, never expired, sorted above every other, and (when billing turns on) spent no credit. | 72: `guard_job_insert` nulls the server's columns for non-admins; `stamp_created_at` on every velocity-counted table |
| 4 | **High** | Suspension (`approval_status = rejected`) took listings down but revoked no data: a suspended employer kept reading applicants' names, numbers and CVs, moving pipelines, writing notes, and unlocking gated consultants through any verified company they belonged to. | 73: `in_good_standing()` folded into `owns_company`, `is_company_admin`, `owns_job`, `viewer_has_verified_company`, `my_company_id` — closes the console, PostgREST and the buckets in one place; `pending` keeps enough to finish signing up |
| 5 | **High** | `profiles_select_applicants` exposed the whole row to any member of a company the candidate applied to — including `unsubscribe_token` (a credential that silences their notifications) and the reviewer's `approval_note`. | 70: both columns moved to `profile_private` (no user policies; admin read for the note); email, unsubscribe route and admin page updated; columns dropped |
| 6 | **High** | Stored XSS via `javascript:` in `companies.website`: zod `.url()` accepts any scheme; onboarding had no URL check; the company page rendered it as `<a href>` under a CSP that allows inline script. | 72: CHECK `^https?://` on `website`, https on `logo_url`/`avatar_url`; `safeHttpUrl()` in `company.ts`, `onboarding.ts` and at render |
| 7 | **Medium** | Storage-path prefix checks (`startsWith(uid + '/')`, `LIKE uid || '/%'`) were bypassable with `..` — storage-js sends paths unencoded and Node normalises dot segments — so a signed URL could be minted for another folder. Random file names made it impractical, not impossible. | 72 + `magic.ts`: shape `^<owner>/[A-Za-z0-9._-]{1,160}$` in code and in the CHECK constraints on `applications.cv_path`, `agent_profiles.cv_path`, `company_documents.storage_path`; `saveCompanyLogo` now confined too |
| 8 | **Medium** | Uploads trusted the declared MIME type; nothing looked at the bytes. HTML/SVG/executables renamed `.pdf`/`.png` were accepted and, for avatars and logos, served from the site's own origin. | `files.ts`/`magic.ts`: CV and document bytes sniffed after upload (PDF/DOCX/DOC; PDF/PNG/JPEG), object removed on refusal, `upload.rejected` event; images now go through `uploadImage()` — decoded and re-encoded to bounded WebP by sharp (EXIF/GPS stripped, decompression bombs refused) |
| 9 | **Medium** | Company membership was imposed without consent, and `my_company_id()` prefers an admin membership, so a victim added as admin to an attacker's company had their whole console silently switch to it; the address lookup behind it was an account/role oracle open to any member. | 72: one company per account enforced by `guard_company_membership`; `company.ts`: lookup restricted to company admins, 20/day, `security_events` on refusal |
| 10 | **Medium** | Rate limits counted a client-supplied `created_at` (back-date a row and it never counts), took no lock (N parallel requests each saw N−1), and had no short window. Listings had no cap at all. | 71/72: server-stamped `created_at`; advisory locks; applications 8/10 min + 30/day; listings 5/day unverified, 20/day verified; third identical title+district in 30 days refused; all thresholds in `abuse_limits` |
| 11 | **Medium** | `settle_order()` trusted `merchant_order_id`, the one field Paymob's HMAC does not sign; a buyer's own signed callback could be replayed against another pending order (the partial unique index was the only thing in the way). | 77: settlement bound to the signed Paymob order id, amount (piastres) and currency; refunded/voided never succeeds; route passes the signed fields |
| 12 | **Medium** | A stolen admin session was the whole platform: `is_admin()` asked only the profile row. | 76: `is_admin()` requires `aal = 'aal2'` once the admin has a verified TOTP factor; `requireAdmin` routes to enrolment/challenge; `MfaSettings` component; `ADMIN_MFA_REQUIRED` switch |
| 13 | **Medium** | Live listings could change district, track, employment type and experience band without re-review, and their slug was mutable by any member. | 72: those four fields are material; slug frozen for owners |
| 14 | **Medium** | `increment_job_view()` was anon-callable and unbounded — and also broken (the guard refused the update from a visitor's session), so view counts were both spoofable and never incremented. | 69/`jobs.ts`: closed to anon/authenticated; the server counts with the service role after the response |
| 15 | **Low** | ~35 places returned Postgres error text to the browser (constraint and trigger names). | Mapped to fixed codes in `jobs.ts`, `company.ts`, `cv.ts`, `employer-jobs.ts`, `account.ts`, `agent-profile.ts`, `onboarding.ts`, `billing.ts`; details go to the log with identifiers |
| 16 | **Low** | `avatar_url` copied from client-writable `user_metadata` — any https URL, drawn as `<img>` to employers and the public. | `onboarding.ts`: only Google's CDN accepted; CHECK on the column |
| 17 | **Low** | Public buckets were listable by anyone (enumerates account and company folders); no per-folder object cap. | 74: world-readable SELECT policies removed (public URLs unaffected); 20 objects per folder via a definer count |
| 18 | **Low** | Cron bearer compared with `!==`. | `secrets.ts`: constant-time, bounded |
| 19 | **Low** | Companies search: `q` and `page` uncapped. | Caps of 120 chars / 500 pages |
| 20 | **Low** | No statement timeout for the API roles. | 75: 5 s anon, 10 s authenticated |
| 21 | **Low** | Notifications were never deduplicated. | 71: identical (user, kind, payload) within 10 min is one row |
| 22 | **Low** | `record_agent_view` counted views of hidden cards by slug; `deleteCvEntry` used `in` (prototype keys). | 69 / `cv.ts` |

Two findings from the audit are **not** fixed and are recorded as risks (§12): malware scanning, and a candidate's inability to remove an uploaded CV from the profile form.

## 4. Row-level security

Reviewed table by table against the dumped final state (87 policies before this round; 91 after). Changes: `profile_private` (admin read only), `audit_log`/`security_events`/`abuse_limits`/`agent_contact_reveals` (admin read; the reveal ledger is also readable by its subject), `rate_limit_buckets` (no policies). Every membership-based policy now requires good standing (finding 4). No policy grants a write with `using (true)`; the two `using (true)` SELECTs are `companies_select_public` (accepted: `owner_id` and `post_credits` are not sensitive in themselves; noted in §12) and `app_settings`.

Tenant isolation, role isolation, applicant privacy, the directory gate, suspension, and the new admin-MFA rule are all exercised in `policies.test.mjs` (292 checks) and `security.test.mjs` (72 checks).

## 5. Storage

Buckets unchanged in shape (`cvs`, `company-documents` private; `avatars`, `company-logos` public; no SVG anywhere). Changes: per-folder cap of 20 objects; public buckets no longer list; path shape enforced in code and constraints; CVs and documents byte-verified before a row points at them; images re-encoded server-side; consultant CVs only through `/api/agent-cv` after a counted reveal; application CVs through `/api/cv` at 60/hour per account. Both routes return five-minute signed URLs by redirect with `no-store`.

## 6. Rate limits and the risk model

All thresholds are rows in `abuse_limits`, shown read-only on `/admin/security`, changed with one UPDATE and a note — no deploy.

| Key | Default | Enforced where |
|---|---|---|
| `contact_reveal:user:hour` / `:day` / `company:day` | 30 / 120 / 300 distinct consultants | `reveal_agent_contact()` |
| `applications:user:10min` / `:day` | 8 / 30 | trigger, all callers |
| `reports:user:day` | 10 | trigger |
| `jobs:company:day` / `company_unverified:day` | 20 / 5 | trigger |
| `jobs:duplicate_copies:30d` | 2 (the third is refused) | trigger |
| `cv_download:user:hour` | 60 | routes |
| `export:user:day` | 5 | route |
| `member_lookup:user:day` | 20 | action |
| `checkout:company:hour` | 5 | action |
| `auth_report:ip:hour` | 120 | action (the report channel itself) |

Progressive friction as specified: normal use meets nothing; a repeat reveal within a day is free; refusals name a wait, not a number; every refusal is a `security_events` row. The "risk engine" is deliberately these explicit, tunable signals plus the events they emit — not a score. Sign-in friction: after repeated failures (by hashed client and by hashed address, 15-minute windows) the form pauses for a few seconds and shows the Turnstile widget instead of running it invisibly; the enforcement is Supabase Auth's own limits and CAPTCHA, which apply to scripts that skip the site.

**Not measured against real usage** — production data was not reachable. The defaults are set well above what a person does (a recruiter opening 30 contacts an hour is busy; 120 a day is a call centre) and are the first thing to tune with `/admin/security` open in the first week.

## 7. Bot protection and Turnstile

Cloudflare Turnstile widget (`components/security/turnstile.tsx`) on sign-in, sign-up, resend and password reset, in `interaction-only` appearance: invisible for almost everyone, visible after failures. The token is passed to Supabase Auth, which verifies it server-side against the secret configured in the dashboard — so the check cannot be skipped by calling `auth/v1` directly. A server-side verifier (`turnstile.ts`) exists for any future anonymous form. **Renders nothing until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, and enforces nothing until the dashboard toggle is on** (§14).

Edge: the domain resolves straight to Vercel; there is no Cloudflare zone. The Vercel Firewall configuration (managed rules, bot challenge on the directory and API, per-path rate rules that challenge before they deny, no challenge on the SEO surface) is in `EDGE_WAF.md` and `vercel-firewall.json` with an apply script. **Not applied** — the token available here lacked the project's team scope.

## 8. Admin security

Admin decisions are in `audit_log` with actor, role, target and before/after (role and approval changes, verification, moderation, featuring, membership, consultant visibility, report resolution). `is_admin()` requires a second factor once enrolled; the console forces enrolment in production and routes an unproven session to the challenge; the account page hosts enrol/verify/disable. The email preview and moderation routes stay behind `is_admin()`. `/admin/security` shows a day of events, the audit trail, top reveal viewers and the live thresholds.

## 9. Database, indexes and scale

New: `statement_timeout` per role; `agent_profiles_directory_order_idx` (the directory's sort over the non-hidden partial); `jobs_company_created_idx` (the daily cap's count); indexes on every new table's access paths. Constraints: URL schemes, array bounds (tracks ≤ 6, districts ≤ 20, languages ≤ 6), text bounds (report detail, rejection note, review note), path shapes — added `NOT VALID` and then validated where the data allows, so a legacy row can never block a deploy. Notifications deduplicate. The migration harness applies all 78 files from an empty database on every test run.

Scale path (10k → 100k MAU): the app is stateless on Vercel; PostgREST is pooled by Supabase; every list is paginated and capped; the counters are one upsert per hit; the two heaviest reads are the board text search (indexed GIN) and `getBrowseCounts()` on the home page, which scans live listings per request by the author's explicit choice — the first thing to cache (60 s) when the board passes a few thousand live rows. Nothing here needs a queue, a second store or a service split before that point.

## 10. Tests

| Suite | Checks | Covers |
|---|---|---|
| `schema.test.mjs` | 28 | migrations apply; anon-callable definer set pinned (now excludes the directory functions) |
| `policies.test.mjs` | 292 | RLS, guards, gate, suspension, idempotency — updated for the reveal model and the two-window application cap |
| **`security.test.mjs`** (new) | 72 | audit trail; private profile columns; reveal allowances, ledger and events; suspension revoking reads, writes, documents and reveals; insert-time integrity; slug freeze and material edits; path traversal and `javascript:` refused at the table; one company per account; listing caps and third-copy rule; server counter and sweep; notification dedupe; storage quota and no public listing; admin AAL2 rule; payment binding; statement timeouts; hidden-card views; view counter closed |
| **`security-libs.test.mjs`** (new) | 46 | sanitiser (tags, bidi, zero-width, controls, link caps), `safeHttpUrl` (schemes in disguise), byte recognition (each accepted type; HTML/EXE/SVG/foreign zip refused), path shape, constant-time secrets |
| `auth.test.mjs` | 74 | redirect safety, hydration-safe forms, session recovery on every action that can say `unauthenticated` (now including the document panel), no PII in logs |
| `messages`, `reads`, `compat`, `match`, `earnings`, `share`, `saved`, `nextaction`, `hmac`, `search`, `email` | — | unchanged and passing |
| `smoke.mjs` (extended) | — | security headers present; private API answers 401/404, never a page; no phone number or WhatsApp link in any public page or consultant page for a visitor |

`pnpm check` passes; `pnpm build` passes.

## 11. Load and abuse testing

`load/k6/`: `browse.js` (10k-MAU peak mix), `spike.js` (a campaign, with a health probe alongside), `authenticated.js` (candidate/employer/admin at honest rates — a 429 fails the run), `abuse.js` (directory scrape, contact harvest via PostgREST directly, application loop via PostgREST directly, credential stuffing against Supabase Auth — each asserting the refusal). Every script refuses a production hostname. **Not run this round** — no staging deployment was reachable from the sandbox. Run them against a preview + Supabase branch before the first production deploy of these migrations, and read `/admin/security` afterwards.

## 12. Remaining risks

- **No malware scanning.** Type recognition and image re-encoding close "not a document at all"; a hostile but well-formed PDF is not detected. Exposure is bounded (private buckets, five-minute signed URLs, entitled and rate-limited viewers, 20 objects per folder). Options when the volume justifies it: a Supabase Storage webhook to a scanning function (ClamAV in a container, or a hosted scanner) that quarantines on hit. Documented as a gap, not pretended away.
- **Turnstile and firewall are configured, not switched on** (§14). Until then, sign-in brute force is bounded only by Supabase Auth's defaults and directory scraping only by the functions' own limits (which are strong) plus Vercel's baseline DDoS protection.
- **Thresholds are untested against real traffic.** Watch `contact.reveal_rate_limited` and `applications.rate_limited` in week one; an honest recruiter hitting a ceiling is a row to raise.
- **A candidate cannot remove an uploaded CV from the profile form** (empty means "unchanged"). Account deletion removes it; a "remove CV" control is a small follow-up.
- **`companies_select_public` exposes `owner_id` and `post_credits`.** UUIDs open nothing and the credit balance is not sensitive today; when billing goes live, move `post_credits` behind a member-only column or a view.
- **Auth runs browser → Supabase by design**, so the platform's own log of failed sign-ins is a client report (rate-limited, hashed) rather than a server observation. Supabase's auth logs are the authoritative record.
- **Service-role reads leave no `audit_log` actor.** They are few and listed in the threat model; PostgREST logs are the record for them.
- **The `SECURITY_SALT` fallback** is `CRON_SECRET`, then a fixed development string. Production must set it, or the security log's hashes are comparable across environments; `/api/health` names it when missing.
- **Session lifetime** is Supabase's default (1-hour access, rotating refresh). Time-boxing sessions is a dashboard setting listed in `SUPABASE_SETTINGS.md`, not enforced by code.

## 13. Recommended future work

1. A CV "remove" control and a storage-versioning switch on the private buckets (30-day recovery of a deleted document).
2. Cache `getBrowseCounts()` for 60 s once the board passes ~2,000 live listings; add the partial covering index the salary reference notes if listing pages slow.
3. An invitation flow for company membership (the one-company rule is the interim).
4. Wire `security_events` `critical` rows to a database webhook → chat channel; add a scheduled job that raises a `warning` when any hashed subject exceeds N events in an hour.
5. Malware scanning on `cvs` and `company-documents` when the file volume makes it worth an engine.
6. Move sign-in into a server action only if the product ever needs per-account lockout policies beyond Supabase's; today the trade (losing GoTrue's per-IP limits) is not worth it.
7. Quarterly restore rehearsal, recorded in `RUNBOOKS.md` §B.

## 14. The production gate

| Gate | State |
|---|---|
| RLS reviewed | **Done** — every table, final state dumped and tested |
| Role isolation tested | **Done** — policies + security suites |
| Tenant isolation tested | **Done** — including suspension |
| Storage secured | **Done in code and schema**; storage versioning is a dashboard toggle (recommended) |
| CVs private | **Done** — signed, entitled, counted |
| Agent contacts protected | **Done** — no contact in any list or card; reveal function with allowances and ledger |
| Admin protected | **Done in schema and app**; requires TOTP enabled in the dashboard and each admin to enrol |
| Rate limiting active | **Done at the database** (applies on deploy); edge rules **documented, not applied** |
| Bot protection active | **Not yet** — needs Turnstile keys on Vercel and the CAPTCHA toggle in Supabase Auth |
| Spam controls active | **Done** — applications, listings, reports, notifications, checkout |
| Upload validation active | **Done** |
| Security headers active | **Done** — CSP (with Turnstile origin when configured), HSTS, nosniff, referrer, permissions; verified by smoke |
| Monitoring active | **Partly** — `/admin/security`, `security_events`, `audit_log` exist; external error monitoring is Vercel's default |
| Alerts configured | **Not yet** — documented in `RUNBOOKS.md` §D |
| Backup strategy verified | **Not yet** — documented; PITR and a restore rehearsal are operator actions |
| Security tests passing | **Done** — 72 + 46 new, all suites green |
| Production build passing | **Done** |

### The five actions that flip the verdict

1. **Deploy this branch with its migrations in one window**: `DATABASE_URL=<direct> pnpm db:push:url` (68–78), then the Vercel deploy. Migration 70 drops two columns the old code reads, so do not leave them apart. Take a manual backup first (`RUNBOOKS.md` §C).
2. **Set on Vercel** (Production and Preview): `SECURITY_SALT`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`; redeploy. **Then** in Supabase: Authentication → Attack Protection → CAPTCHA = Turnstile with the same secret; Multi-factor → TOTP enabled; rate limits and password policy per `SUPABASE_SETTINGS.md`. Each admin enrols at `/dashboard/account`.
3. **Apply the firewall**: `scripts/vercel-firewall.mjs` with a token that has the team scope, then turn on Bot Protection and the managed ruleset in Log mode for a week.
4. **Alerts and backups**: the four pages and the daily glance in `RUNBOOKS.md` §D; enable PITR and storage versioning.
5. **Prove it on staging**: `load/k6/abuse.js` and `authenticated.js` against a preview wired to a Supabase branch, then one restore rehearsal recorded in `RUNBOOKS.md` §B.

When those five are done, every row in the gate table reads "Done", and the classification becomes **SECURITY READY FOR PRODUCTION**. Until then it is not, and the reason is entirely operational, not architectural.
