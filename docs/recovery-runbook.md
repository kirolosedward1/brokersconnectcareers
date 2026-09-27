# Recovery runbook

For the person on call when something has gone wrong. The background,
decisions and test results are in [disaster-recovery.md](disaster-recovery.md).

**Before anything else:**

1. **Open an incident log entry**: a dated note (not in this repo) with who,
   when it started, what was seen, and every action taken with its time.
   Every recovery, restore and key rotation gets one.
2. **Do not restore over production first.** Restore somewhere else, verify,
   then decide. The scripts refuse production unless
   `DR_ALLOW_PRODUCTION=hiwdhicwsohbipxzazmb` is set; set it only as a
   deliberate last step.
3. **Snapshot the damaged state before changing it:**
   `pnpm dr:backup ~/dr/<time>-damaged`. It is evidence, and your undo if the
   fix goes wrong.

Useful everywhere:

- Health: `https://www.brokersconnect.net/api/health` returns 200 when the
  platform can serve and 503 when it cannot.
- Pause the crons (expiry, alerts, digests, email retry): Vercel → Project →
  Settings → Cron Jobs → Disable. Remember to re-enable them.
- Production ref: `hiwdhicwsohbipxzazmb`. `DATABASE_URL` must be the direct
  connection (port 5432), not the pooler. `pg_dump`/`psql` must be version 17
  or newer.

---

## 1. Database accidentally modified

A bad `delete`/`update`, an app bug writing wrong values, or an operator
mistake in the SQL editor.

**Detect.** User reports, missing listings or applications, `/api/health`
still 200 (the database is up; the data is wrong). Find the extent with SQL:
which tables, which ids, since when. Timestamps (`created_at`, `updated_at`)
and `application_events` help.

**Contain.**

- Stop the source. Revert or roll back the deploy if it is an app bug (§4).
  If it is a person, stop them.
- Pause the crons if the bad rows could trigger email (digests, job alerts,
  email retry).
- Take the damaged-state backup (see top).

**Recover** from the newest backup taken *before* the damage. Pull the
affected rows out of that backup through a scratch database. Never restore
the backup over production.

1. **Work out what the damage cascaded to.** Deleting an application also
   deletes its `application_events` and `application_notes`. Deleting a job,
   company or profile cascades further. List the children:

   ```sql
   select conrelid::regclass child, confrelid::regclass parent
     from pg_constraint where contype = 'f' and confdeltype = 'c'
      and confrelid = 'public.applications'::regclass;  -- repeat per table
   ```

2. **Build a scratch database with those tables from the backup.** Use a local
   Postgres 17+, or a throwaway Supabase project:

   ```bash
   createdb dr_scratch
   psql dr_scratch -f scripts/dr/supabase-stub.sql      # plain Postgres only
   pg_restore -d dr_scratch --no-owner --schema-only --schema=public full.dump
   pg_restore -d dr_scratch --no-owner --data-only --disable-triggers \
     -t applications -t application_events -t application_notes full.dump
   ```

3. **Deleted rows:** export them as inserts that skip rows that still exist.
   Strip the `setval` lines, because replaying them rewinds production's
   sequences and the next insert collides:

   ```bash
   pg_dump dr_scratch --data-only --inserts --on-conflict-do-nothing \
     -t public.applications -t public.application_events -t public.application_notes \
     | grep -v '^SELECT pg_catalog.setval' > copy-back.sql
   ```

   **Modified rows:** copy the backup's version into a plain `recovery`
   table (no triggers, no keys), load that into production, and update from
   it explicitly:

   ```bash
   psql dr_scratch -c 'create schema recovery; create table recovery.jobs as select * from public.jobs'
   pg_dump dr_scratch --no-owner -t recovery.jobs > recovery.sql
   # pg_dump -t does not create the schema. `recovery` is not exposed through
   # the API, but drop it as soon as you are done.
   psql "$DATABASE_URL" -X -c 'create schema recovery'
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f recovery.sql
   ```

   See which rows differ, then generate an update that puts **every**
   column back. The bad statement's triggers also moved columns you did not
   name (`updated_at`, `version`), so restoring only the obvious ones leaves
   those behind:

   ```sql
   select j.id from public.jobs j join recovery.jobs r using (id)
    where row(j.*) is distinct from row(r.*);

   select 'update public.jobs j set '
          || string_agg(format('%1$I = r.%1$I', column_name), ', ' order by ordinal_position)
          || ' from recovery.jobs r where j.id = r.id and row(j.*) is distinct from row(r.*);'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name <> 'id' and is_generated = 'NEVER';
   ```

   Review the generated statement, add `and j.id in (…)` if only some rows
   should go back, and run it with triggers off. Putting rows back must not
   notify anyone or bump versions again:

   ```sql
   begin;
   set local session_replication_role = replica;
   update public.jobs j set … ;   -- the generated statement
   -- check the row count, then
   commit;
   drop schema recovery cascade;
   ```

4. **Read `copy-back.sql`**, then apply it in one transaction with triggers
   off, so the rate limits and notifications don't fire for replayed history:

   ```bash
   PGOPTIONS='-c session_replication_role=replica' \
     psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f copy-back.sql
   ```

5. **Undo side effects of the incident.** The mistake may have fired
   triggers: a mass delete of applications notifies employers of withdrawals
   that never happened. Remove `notifications` (and unsent `email_log` rows)
   created by the incident. Any email that already went out needs a human
   follow-up.

**Verify.**

- Row counts for the affected tables match the backup plus anything
  legitimately written since.
- Re-run the foreign-key check from `scripts/dr/verify.mjs`: triggers were
  off, so nothing else proved the keys.
- `pnpm dr:drift` against production reports no drift.
- Sign in as an affected user and look.

**Monitor.** Watch for 24 h: Supabase → Logs (API and Postgres errors),
Vercel runtime errors, user reports. Re-enable the crons. Take a fresh backup
once recovery is done.

## 2. Database unavailable or lost

**Detect.** `/api/health` returns 503. Every page shows its error state. The
Supabase dashboard shows the project paused, unhealthy, or gone.

**Contain.**

- Check the Supabase dashboard project status and <https://status.supabase.com>.
- **Paused** (Free plan, inactivity): Dashboard → project → Restore/Unpause.
  Data is intact. Done.
- **Supabase incident in the region:** wait and communicate. Restoring
  elsewhere does not beat their recovery unless it runs for many hours.
- **Deleted, corrupted, or unrecoverable:** continue below.

**Recover** into a new project (verified path; see disaster-recovery.md §8):

1. Create a new Supabase project. Use the same region (ap-south-1) and a
   strong database password.
2. `TARGET_DATABASE_URL=<new direct URL> pnpm dr:restore <latest backup dir>`.
   This rebuilds the schema from git, loads data, and runs every verify check.
   Do not proceed on a FAIL.
3. Storage: `TARGET_SUPABASE_URL=… TARGET_SUPABASE_SERVICE_ROLE_KEY=… pnpm
   dr:storage:restore <latest storage backup>`.
4. Rewrite absolute storage URLs to the new project:

   ```sql
   update companies set logo_url = replace(logo_url,
     'https://hiwdhicwsohbipxzazmb.supabase.co', 'https://<NEW_REF>.supabase.co')
    where logo_url like 'https://hiwdhicwsohbipxzazmb.supabase.co/%';
   update profiles set avatar_url = replace(avatar_url,
     'https://hiwdhicwsohbipxzazmb.supabase.co', 'https://<NEW_REF>.supabase.co')
    where avatar_url like 'https://hiwdhicwsohbipxzazmb.supabase.co/%';
   ```

5. Re-enter the dashboard-only configuration in the new project:
   - [ ] Authentication → URL Configuration: Site URL, and
     `https://www.brokersconnect.net/auth/callback` in redirect URLs
   - [ ] Authentication → SMTP: `smtp.resend.com:587`, user `resend`, the
     Resend API key, sender `noreply@brokersconnect.net` / "Brokers Connect"
   - [ ] Authentication → Providers → Google: client id and secret. Also add
     the new project's callback URL in Google Cloud Console
   - [ ] Authentication → Email templates: paste from `supabase/templates/`
     (`pnpm auth:templates` prints the subjects)
   - [ ] Email confirmations on; rate limits as before
   - [ ] Database → "Enable RLS automatically" setting (the `ensure_rls` event
     trigger)
   - [ ] API keys: note the new publishable and secret keys
6. Vercel → Environment Variables (Production and Preview):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`. Then **redeploy**: the public values are
   baked in at build time.
7. Update `.mcp.json` and any local `.env.local` to the new ref, and update
   `PROD_REF` in `scripts/dr/*` and `scripts/db-push.mjs`.

**Verify.** `pnpm dr:verify` (already run by restore). `/api/health` returns
200. Sign in with email and with Google. Apply to a job. Open a CV as the
employer (signed URL). Send a password reset (proves SMTP).

**Monitor.** Users' existing sessions are invalid, since the new project has
new signing keys. Expect sign-in support requests. Watch auth logs for failed
logins. If password hashes did not carry over, send password-reset emails.
Keep the old project, if it exists, paused rather than deleted until you are
sure.

## 3. Storage objects lost

**Detect.** Logo or avatar images 404. A CV download (`/api/cv/…`) fails.
Find rows pointing at missing files:

```sql
select 'cv', cv_path from agent_profiles a where cv_path is not null
   and not exists (select 1 from storage.objects o where o.bucket_id = 'cvs' and o.name = a.cv_path)
union all
select 'application cv', cv_path from applications a where cv_path is not null
   and not exists (select 1 from storage.objects o where o.bucket_id = 'cvs' and o.name = a.cv_path)
union all
select 'document', storage_path from company_documents d
 where not exists (select 1 from storage.objects o
                    where o.bucket_id = 'company-documents' and o.name = d.storage_path);
```

**Contain.** Find what deleted them: an app bug, a leaked service key (§5),
or a person. Stop it. If the service key could be involved, rotate it now.

**Recover.** Restore only the gaps. The script never overwrites:

```bash
DR_ALLOW_PRODUCTION=hiwdhicwsohbipxzazmb \
TARGET_SUPABASE_URL=https://hiwdhicwsohbipxzazmb.supabase.co \
TARGET_SUPABASE_SERVICE_ROLE_KEY=… \
  pnpm dr:storage:restore <storage backup dir> [--only cvs/]
```

Files uploaded after the last storage backup cannot be recovered. Ask those
users to re-upload. A CV an applicant sent is part of their application:
tell the employer, and keep the row.

**Verify.** The query above returns nothing, or only the files that post-date
the backup. The script reports every restored object hash-checked.

**Monitor.** Storage logs for deletes over the next days. Confirm the next
scheduled storage backup completes.

## 4. Bad deployment

**Detect.** Vercel build or runtime errors, a rise in 500s, `/api/health` 503
after a deploy, user reports right after a release.

**Contain and recover.** Vercel → Deployments → the last good production
deployment → **Instant Rollback** (Hobby plans can only go back to the
previous one). This rolls back code only.

- **Did the release include a migration?** If the old code cannot work with
  the new schema, fix forward, or treat it as a bad migration (§6). Never
  roll the database back just to match old code without reading §6.
- Crons follow the deployment. Check that they still return 200.

**Verify.** `/api/health` returns 200. The pages the release touched work.
Vercel runtime logs are clean.

**Monitor.** Fix the cause in a PR. Redeploy only after it passes
`pnpm typecheck`, `pnpm build` and `pnpm test:db`.

## 5. Service key or other secret exposed

Treat a leaked `SUPABASE_SERVICE_ROLE_KEY`, database password or JWT secret
as full data access by someone else. It bypasses every RLS policy, on the
CVs as well.

**Detect.** GitHub secret-scanning alert, a key found in a log, screenshot,
chat or commit, or unexplained activity in Supabase logs (service-role
requests the app did not make).

**Contain: rotate first, investigate after.**

| Secret | Where it lives | Rotate |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`) | Vercel env (Prod + Preview), local `.env.local` | Supabase → Settings → API Keys → create a new secret key → update Vercel → redeploy → confirm health → **delete the old key**. If legacy JWT keys are still enabled, disable them |
| Database password (`DATABASE_URL`) | Operators' machines, backup job | Supabase → Database → Settings → Reset password; update the backup job |
| JWT signing key | Supabase | Supabase → Settings → JWT Keys → rotate. Signs everyone out |
| Supabase personal access tokens / MCP OAuth | Operators' accounts | Account → Access Tokens → revoke; Organization → Team → review members, enforce MFA |
| `RESEND_API_KEY` | Vercel env **and** Supabase Auth SMTP password | New key in Resend → Vercel → Supabase SMTP → redeploy → test a password reset → revoke the old key |
| `RESEND_WEBHOOK_SECRET` | Vercel env | Resend → Webhooks → rotate signing secret → Vercel → redeploy |
| `CRON_SECRET` | Vercel env | New random value → Vercel → redeploy (Vercel sends the new one automatically) |
| `PAYMOB_*` (API key, HMAC secret) | Vercel env | Paymob dashboard. Billing is off today (`BILLING_ENABLED=false`), but rotate anyway |
| Google OAuth client secret | Supabase Auth provider | Google Cloud Console → reset secret → Supabase → Providers → Google |
| Backup key (`age` private key) | Offline, with the owners (D5) | Generate a new pair, switch `AGE_RECIPIENT`, and treat every backup encrypted to the old key as exposed |
| Vercel / GitHub / domain registrar accounts | People | Password + MFA reset; review deploy hooks, collaborators, DNS records and registrar lock |
| Demo accounts' shared password (`password123`) | README of a **public** repo; confirmed still valid on all 15 production demo accounts, admin included (2026-09-27) | 1. Create your real admin: sign up and finish onboarding with an address you control (not the candidate account you test with), then in the SQL editor `update profiles set role = 'admin' where id = (select id from auth.users where email = '<you>')`. Turn on MFA for that account. 2. Authentication → Users → each `@demo.test` user → Ban, or Delete if you no longer need the demo listings (deleting cascades their companies, jobs and the applications to them). 3. Revoke their sessions: `delete from auth.sessions where user_id in (select id from auth.users where email like '%@demo.test')`. 4. Remove the password from the README's production-facing text. Never seed demo accounts into production again |

**Recover.** Work out what the key could reach and for how long. Read
Supabase API, Storage and Auth logs for the exposure window: exports, bulk
reads, deletes. If data was modified or deleted, go to §1 or §3. If personal
data may have been read, get legal advice promptly: Egypt's Personal Data
Protection Law (151/2020) carries breach-notification duties. Do not delay
the rotation for this.

**Verify.** The old key is rejected (a request with it returns 401).
`/api/health` returns 200 with the new one. Email sending works. Crons
return 200 at their next run.

**Monitor.** Watch logs for use of the old key for at least a week. Close the
incident only after the leak's source (commit, log, screenshot) is removed or
expired.

## 6. Failed or destructive migration

**Detect.** The migration errored halfway through, the app broke right after
it, or data is visibly wrong. `pnpm dr:drift` against production shows the
change.

**Contain.** Stop further migrations. Pause the crons if they could act on
the broken schema. Take a damaged-state backup.

**Recover**, from least to most drastic:

1. **Forward fix:** a new migration that corrects it. Best when nothing was
   lost.
2. **Reverse SQL:** from the PR, for reversible changes.
3. **Recover lost rows or columns** from the pre-migration backup, as in §1.
   This is the rollback for a `drop`.
4. **Full restore into a new project** from the pre-migration backup (§2). You
   lose everything written since that backup.
5. **Last resort, in place:**
   `DR_ALLOW_PRODUCTION=hiwdhicwsohbipxzazmb TARGET_DATABASE_URL=<prod> pnpm
   dr:restore <pre-migration backup>`. This drops and rebuilds `public`,
   replaces every account, and loses everything since the backup. Only do it
   with a damaged-state backup in hand and the owner's explicit decision in
   the incident log.

**Verify.** `pnpm dr:drift` shows only the intended changes. Run
`pnpm dr:verify` if a restore was involved. Smoke-test the flows the
migration touched.

**Monitor.** Postgres logs for errors. Supabase advisors (Database → Advisors)
for new security or performance warnings.
