# Runbooks — incidents, backups, change control, alerting

## A. Incident response

Every incident follows the same six steps. What differs per incident is the *contain* and *revoke* step, listed below.

**Detect → Contain → Revoke → Rotate → Investigate → Recover → Notify.**

Where to look, in order: `/admin/security` (events, audit trail, reveal counts), Supabase → Logs (auth, postgrest, storage), Vercel → Logs and Firewall, `security_events` and `audit_log` tables directly (`select … order by created_at desc`).

### A1. A user account is compromised

1. **Contain**: Supabase → Authentication → Users → the account → *Ban user* (banned accounts cannot refresh a session). Or SQL: `select set_account_approval('<user>', 'rejected', 'compromise <date>')` as an admin — suspension revokes every company read/write and every reveal (migration 73) and takes the company's listings down if nobody else approved remains.
2. **Revoke**: Authentication → Users → *Sign out user* (kills refresh tokens).
3. **Investigate**: `select * from audit_log where actor_id = '<user>' order by id desc;` and `select * from agent_contact_reveals where viewer_id = '<user>' and created_at > now() - interval '30 days';` — the second is the list of consultants whose numbers were taken.
4. **Recover**: reset the password with the person over a verified channel; un-ban; `set_account_approval(..., 'approved')`.
5. **Notify**: the consultants in the reveal list, if the account was an employer used to harvest.

### A2. An admin account is compromised

1. **Contain**: SQL as `postgres` (dashboard SQL editor): `update profiles set role = 'employer' where id = '<admin>';` — the guard trigger allows it for a direct connection. Then *Sign out user*.
2. **Revoke** anything the session could have minted: check `audit_log` for `job.moderated`, `company.verification_changed`, `account.approval_changed`, `company.credits_changed` rows with this actor since the suspected time, and reverse each (`set_account_approval`, `update companies set verification_status …`, `update jobs set status …` as postgres).
3. **Rotate**: nothing platform-wide is exposed by an admin session (it holds no service key), but review Authentication → Users for accounts created or approved in the window.
4. **Recover**: the admin re-enrols TOTP (`/dashboard/account`) on a clean device before the role is restored. Confirm `ADMIN_MFA_REQUIRED` is not `false`.

### A3. The service-role key is exposed (in a log, a commit, a screenshot)

1. **Rotate first, investigate second**: Supabase → Project Settings → API → *Generate new secret key*; set `SUPABASE_SERVICE_ROLE_KEY` on Vercel → Production and Preview; redeploy. `/api/health` reports `serviceRole: rejected` until the new key is live, and `ok` after.
2. **Investigate**: Supabase → Logs → PostgREST, filter `role=service_role`, over the exposure window. The service role bypasses RLS and leaves no `audit_log` actor, so the PostgREST log is the record.
3. **Notify**: if the log shows reads of `profiles`, `applications` or storage objects that the application's own code paths would not have made at that time, treat as a data breach (see A6).

### A4. Database credentials (`DATABASE_URL`) are exposed

Reset the database password (Project Settings → Database → *Reset database password*); `DATABASE_URL` is only used by local scripts and is not on Vercel, so nothing redeploys. Check `pg_stat_activity` for unknown clients and Logs → Postgres for DDL.

### A5. Spam, scraping or sign-in attack in progress

- Symptoms: `/admin/security` shows rate-limited events climbing; Vercel Firewall shows a rule matching; Supabase auth logs show `invalid_credentials` in bulk.
- **Contain**: Vercel → Firewall → *Attack Challenge Mode* (challenges every visitor; use for minutes, not days). Tighten the relevant rate rule in `docs/security/vercel-firewall.json` and apply.
- For a harvester already signed in: find them in `agent_contact_reveals` (top viewers on `/admin/security`), suspend via `set_account_approval`. Lower `abuse_limits` for `contact_reveal:*` temporarily: `update abuse_limits set max_hits = 10 where key = 'contact_reveal:user:hour';` — takes effect on the next call, no deploy.
- For application spam: same with `applications:user:10min`.
- For a sign-in attack on one address: Supabase's own limits hold; tell the person and have them change their password (which ends other sessions).

### A6. A data leak is suspected

1. Scope it: which table or bucket, which rows, which window. `audit_log`, `agent_contact_reveals`, PostgREST logs, Storage logs.
2. Preserve: export the relevant log rows to a file outside the database before anything is cleaned up.
3. Egyptian law (Law 151/2020) and the platform's own privacy page require telling affected people without undue delay when their personal data (numbers, CVs) was exposed. The consultant reveal ledger is designed to make that list computable.

### A7. A malicious upload is reported

- The file is in a private bucket (`cvs`, `company-documents`) or a public one (`avatars`, `company-logos`; both are server-re-encoded WebP since this round, so a hostile image cannot be served as uploaded).
- Remove: Storage → bucket → object → delete, then null the referencing column (`applications.cv_path`, `agent_profiles.cv_path`, `company_documents` row). Suspend the uploader if it was deliberate.
- Record: `select record_security_event('upload.malicious_reported', 'critical', null, '{"bucket": "cvs"}'::jsonb, '<uploader>');` as postgres.

### A8. DDoS

Vercel absorbs volumetric attacks at the edge; turn on Attack Challenge Mode for application-layer floods. Watch Supabase → Reports for database CPU; the per-role statement timeouts (5 s / 10 s) stop a slow-query flood from holding the pool. If the database is the target through PostgREST directly (the anon key is public), Supabase support can enable API-level rate limits on the project.

### A9. Email abuse (the platform used as a relay)

Every outbound mail goes through `claim_email()` with a dedupe key and the suppression list, and Supabase Auth's mail is capped per hour in the dashboard. If Resend reports a spike: Resend → Logs by template; pause the sending domain; find the entity ids in `email_log` and suspend the accounts behind them.

## B. Backups and restore

**What Supabase provides on the Pro plan**: daily logical backups, retained 7 days (longer on higher tiers); optional Point-in-Time Recovery (PITR) with a 2-minute RPO. Storage objects are replicated by the provider but are *not* included in database backups.

| Question | Answer |
|---|---|
| Frequency | Daily (backups); continuous WAL (PITR, when enabled) |
| Retention | 7 days daily; PITR 7 days by default |
| RPO | 24 h without PITR, ~2 min with |
| RTO | 15–60 min for a restore of this size (tens of MB); dominated by human steps below |
| Who can restore | Anyone with Owner/Admin on the Supabase organisation. Keep that list to two people and record it in the team's access sheet. |

**Restore procedure (tested path)**

1. Do not restore over production first. Supabase → Database → Backups → *Restore to a new project* (or use Branching). This yields a second project with the data as of the chosen point.
2. Point a preview deployment at it: set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` on a Vercel preview branch; run `pnpm smoke https://<preview>` and `pnpm doctor` against it.
3. If the data is right, either promote the restored project (update the three variables on Production, redeploy, re-point Auth Site URL) or copy the specific rows back with `pg_dump --data-only -t <table>` from the restored project into production.
4. Storage: objects are not in the backup. A deleted CV is gone unless Storage versioning is enabled (Storage → Settings); enable it for `cvs` and `company-documents` — the cost is small and it turns "deleted" into "recoverable for 30 days".

**Restore rehearsal**: the schema and seed path is rehearsed on every `pnpm test:db` run (PGlite applies all 78 migrations from scratch) and can be rehearsed against a real Postgres with `pnpm db:rehearse`. A full data restore rehearsal against a Supabase branch should be done once per quarter; record the date and the time it took in this file.

| Date | Restored from | Time to usable preview | By |
|---|---|---|---|
| _(none yet — schedule the first one after this round is deployed)_ | | | |

## C. Change control for security-sensitive deploys

1. **Backup**: confirm last night's backup exists (Database → Backups); if the change touches `profiles`, `applications`, `companies` or storage policies, take a manual one (`pg_dump` via `DATABASE_URL`).
2. **Migration review**: every file under `supabase/migrations/` is numbered, prose-commented, and applied by `pnpm test:db` from an empty database on every run; a migration that breaks the harness cannot pass CI. Destructive steps (this round drops two columns in 70) copy the data first and say so.
3. **Tests**: `pnpm check` (typecheck, catalogue, reads, security libs, schema, policies, **security**, hmac, search, email, auth).
4. **Staging**: apply migrations to a Supabase branch or the staging project with `DATABASE_URL=… pnpm db:push:url`; deploy the branch to a Vercel preview; run `pnpm smoke <preview-url>`.
5. **Production**: apply migrations (`pnpm db:push:url` against production `DATABASE_URL` from a trusted machine — the pooler port rejects multi-statement DDL, use the direct connection), then deploy. Order matters for this round: migration 70 drops `profiles.unsubscribe_token`, and the new code reads `profile_private`; deploy the code in the same window.
6. **Smoke**: `pnpm smoke https://www.brokersconnect.net`; open `/api/health`; sign in as an admin and open `/admin/security`.
7. **Rollback**: Vercel → *Instant rollback* for the code. For the database: migrations 68–78 are additive except 70 (columns) and 69 (function signature). Rolling back code to before this round against a database after it breaks the unsubscribe path and the directory page; roll forward instead, or restore from backup per section B.

## D. Alerting — what to page on, what to look at weekly

**Page (someone looks within the hour)**
- `/api/health` returns 503 for 3 consecutive checks (uptime monitor).
- Vercel: 5xx rate > 2 % over 5 min.
- Supabase: database CPU > 80 % for 10 min; connections > 80 % of pool.
- `security_events` with `severity = 'critical'` (none are emitted automatically today; A7 above records one by hand — wire a database webhook on insert when the volume justifies it).

**Look at daily (the `/admin/security` page, one glance)**
- Failed sign-ins per 24 h above ~50, or concentrated on one hashed subject.
- Any `contact.reveal_rate_limited` — that is a person hitting the ceiling, which is either a scraper or a ceiling set too low; both are worth a look.
- `jobs.rate_limited` / `jobs.duplicate_refused` — a company mass-posting.
- `upload.rejected` above a handful — somebody probing the upload path.

**Look at weekly**
- Vercel Firewall matches per rule; retune per EDGE_WAF.md §6.
- Resend delivery rate and bounces; `email_activity_summary()`.
- Top 5 reveal viewers (on the page) — should be recognisable recruiters.

Alert fatigue is avoided by design: nothing above fires on a single event except a critical one, and the daily items are a page a person reads, not a channel that pings.
