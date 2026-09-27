# Backup and disaster recovery

Status as inspected on **2026-09-27**, against the live project
(`hiwdhicwsohbipxzazmb`, Postgres 17.6, region ap-south-1) and this repository.
The step-by-step procedures are in [recovery-runbook.md](recovery-runbook.md).

**Bottom line:** recovery is possible. It is not yet ready. The recovery path
has been built and rehearsed end to end on a throwaway Postgres. The schema
half has also been rebuilt on a real Supabase project, where it matches
production exactly. But **no backup of production exists today.** The Supabase plan keeps none, and nobody has run the new scripts
against production yet. If the database were lost this afternoon, the schema
could be rebuilt from git and all data would be gone.

---

## 1. What production is today

| | Finding | How it was established |
|---|---|---|
| Plan | **Supabase Free** (org "Brokers Connect Career") | Management API |
| Platform backups | **None usable.** Free-plan projects get no downloadable or restorable daily backups. | Supabase docs; plan |
| Point-in-time recovery | Not available (Pro add-on only) | Supabase docs |
| Branches / staging | None. One project, which is production. | Management API |
| Database size | 21 MB. 17 auth users (15 are `@demo.test`), 7 companies, 18 jobs, 33 applications | SQL, read-only |
| Storage | 4 buckets: `cvs`, `company-documents` (private), `company-logos`, `avatars` (public). 2 objects in total (1 logo, 1 avatar); no CVs or documents yet | SQL, read-only |
| Storage backup | **None.** No Supabase plan backs up Storage objects. Deleted files are unrecoverable. | Supabase docs |
| Schema in git vs production | **Identical**: all 691 objects match (221 columns, 140 constraints, 93 indexes, 87 policies, 73 functions, 30 triggers, 28 RLS switches, 15 enums, 4 buckets) | `scripts/dr/fingerprint.sql` on both sides |
| Migration history | Production's 73 recorded versions (`20260831…`–`20260922…`) do **not** match the 67 repo filenames (`20260101…`). The resulting schema is the same. | `list_migrations` vs `supabase/migrations/` |
| Data integrity | Every constraint is validated. No orphaned profiles. Every CV/document path points at an existing object. | SQL, read-only |
| Not in any migration | The `ensure_rls` event trigger (`rls_auto_enable`), created by Supabase's "enable RLS automatically" setting | SQL |
| Vault | Empty | SQL |
| Auth providers in use | email, google | SQL |
| Deployment | Vercel, per the README and `vercel.json` (4 crons); the repo's homepage is `brokersconnectcareers-five.vercel.app`. **Not verified.** The Vercel connector in this session reaches only a team with no projects, and the live site could not be fetched from here. | Vercel API, GitHub |
| Domain | `brokersconnect.net` is **not** in the connected Hostinger account, which holds about 200 other domains. Registrar unknown; registrar lock and DNS backups unverified. | Hostinger API |
| Repository | **Public** on GitHub. Anything in it, the README included, is readable by anyone. | GitHub API |

## 2. Gaps

Ordered by what would hurt first.

1. **The production admin account's password is published, and it works.**
   The only `admin` in production is `admin@demo.test`. A read-only bcrypt
   comparison inside the database (not a login) confirmed on 2026-09-27 that
   all 15 `@demo.test` accounts, admin included, still have the password
   `password123`. The README publishes that password, and the repository is
   public. The admin account had 10 active sessions. A real candidate's
   application sits on a listing owned by `employer2@demo.test`, so anyone
   can read it. Fix before anything else: runbook §5, last row, and decision
   D6. An attempt to rotate the passwords from this session was blocked by
   its permission policy, so nothing has changed yet.
2. **No database backup exists.** Anything deleted, corrupted or migrated
   away is lost. Closing this needs one run of `pnpm dr:backup`, then a
   schedule (D2, D3).
3. **No storage backup exists.** This matters most from the day the first
   real CV arrives.
4. **`supabase db push` would be dangerous against production.** Because
   the migration versions differ (§1), the CLI would treat all 67 repo files
   as unapplied. Production migrations are applied one at a time through the
   Supabase MCP/SQL editor. Keep it that way, or reconcile the history first
   (§6).
5. **No staging environment.** Migrations are first run against production.
   The local suites (`pnpm test:db`, `pnpm dr:rehearse`) catch a lot, but not
   everything a real Supabase project does.
6. **Restoring into a new project breaks absolute URLs.** `companies.logo_url`
   and `profiles.avatar_url` store `https://hiwdhicwsohbipxzazmb.supabase.co/…`.
   The runbook rewrites them; it is an easy step to forget.
7. **Auth configuration lives only in the dashboard.** Site URL, redirect
   URLs, SMTP (Resend), Google provider, email templates, rate limits and the
   auto-RLS setting are not in any backup. They have to be re-entered by hand
   in a new project. Runbook §2 lists them.
8. **Free projects pause after a week of low activity.** A paused project
   is an outage until someone unpauses it.
9. **No audit trail of platform actions.** Supabase organisation audit logs
   are a paid-plan feature. Today the only records are `operator.txt` in each
   backup and the incident log the runbook asks for.
10. **The repository lives in an iCloud-synced folder** (see `.gitignore`).
    The backup scripts therefore require an output directory and refuse to
    write plaintext unless told to. A backup of CVs must not land in a
    personal iCloud.
11. **The one real accidental-delete path cascades.** Deleting an application
    also deletes its events and notes. It fires the withdrawal trigger too,
    which notifies employers about withdrawals that never happened. The
    rehearsal proved both, and the runbook handles both.

## 3. RPO and RTO

RPO is how much recent data you can afford to lose. RTO is how long the
platform can be down. The table gives realistic figures for each option. The
choice is yours (D1); nothing below is a commitment until you pick one.

| Option | Monthly cost | Database RPO | Storage RPO | RTO: bad row / table | RTO: whole database |
|---|---|---|---|---|---|
| **A. As today** (Free, no schedule) | $0 | Unbounded: time since someone last ran the script | Unbounded | 30–60 min, if a backup exists | 2–4 h to a new project, if a backup exists |
| **B. Free + nightly scheduled backups** | $0 | 24 h | 24 h | 30–60 min | 2–4 h to a new project |
| **C. Pro + nightly off-site backups** | ~$25 | 24 h (7 days of platform backups, plus ours) | 24 h (ours only) | 30–60 min | ~30–60 min in place (downtime scales with size; minutes at 21 MB) |
| **D. Pro + PITR 7 days + Small compute** | ~$140 | ~2 min | 24 h (ours only) | 30–60 min | ~30–60 min to any second in 7 days |

Notes on the figures:

- RTO for "whole database to a new project" includes re-entering auth
  configuration and redeploying Vercel, since the Supabase URL is baked into
  the client bundle. The 2–4 h figure assumes a first-time operator following
  the runbook. It has **not** been timed against a real Supabase project; the
  first real restore drill (§8) should replace it with a measured number.
- A platform restore (C, D) rewinds the **whole** database. Everything written
  after the restore point is lost. For a single bad delete, the scratch-restore
  path in the runbook is still the right tool, on every plan.
- Storage has no platform backup on any plan. Its RPO is always the schedule
  of `pnpm dr:storage:backup`.

**Recommendation:** B now, while the board is pre-launch and holds demo data.
Move to C before real candidates upload CVs: it also ends inactivity pausing
and adds support. Consider D once losing a day of applications would cost
real money.

## 4. Decisions required from the owner

| # | Decision | Recommended default |
|---|---|---|
| D1 | Target RPO/RTO, and so the plan (§3) | B now, C at launch |
| D2 | Where encrypted backups live. It should be a different provider and account from Supabase, so one compromised login cannot delete both. | An S3-compatible bucket (Backblaze B2, AWS S3) with object lock / versioning, in an account only the owners hold |
| D3 | Who runs the schedule. GitHub Actions needs `DATABASE_URL` and the service-role key as repository secrets, which widens who can read them. An owner-controlled machine keeps them narrower but depends on that machine. | An owner-controlled scheduled job while the team is small |
| D4 | Retention. Deleted accounts persist in backups until those expire, so this is also a privacy question for whoever writes `/privacy`. | 7 daily, 4 weekly, 3 monthly; nothing older than 90 days |
| D5 | Who holds the `age` private key that decrypts backups | Two people, stored offline (password manager + paper). Never in the repo, on Vercel, or in CI |
| D6 | The demo accounts in production | Before launch: create a real admin with MFA, then delete or ban all `@demo.test` users. Stop documenting their password for production |
| D7 | A staging project | A second Free project (the org allows two) used only for migration rehearsals |
| D8 | Privileged operators (§7) | Two owners with MFA; nobody else holds restore or delete rights |

## 5. Tooling added

All scripts are under `scripts/dr/` and exposed as `pnpm dr:*`.

| Command | What it does | Touches production? |
|---|---|---|
| `pnpm dr:backup <dir>` | `pg_dump` custom archive + data-only SQL + schema fingerprint + per-table hashes + operator record + checksums; `age`-encrypts if `AGE_RECIPIENT` is set, refuses plaintext unless `DR_ALLOW_PLAINTEXT=1` | Read-only |
| `pnpm dr:storage:backup <dir>` | Downloads every object in every bucket with a sha256 manifest; incremental | Read-only |
| `pnpm dr:restore <dir>` | Rebuilds schema from migrations, loads data, runs verify. Refuses the production ref unless `DR_ALLOW_PRODUCTION=<ref>` | Refused by default |
| `pnpm dr:storage:restore <dir>` | Uploads missing objects, never overwrites, checks every hash. Production needs `DR_ALLOW_PRODUCTION` | Only fills gaps |
| `pnpm dr:verify <dir>` | Schema, data hashes, every FK and CHECK re-proved, RLS and triggers exercised as real users in a rolled-back transaction | Read-only (rolled back) |
| `pnpm dr:drift` | Compares a database with what the migrations build | Read-only |
| `pnpm dr:rehearse` | The whole cycle on a throwaway Postgres, plus an accidental-delete recovery | Never; refuses a Supabase URL |
| `.github/workflows/dr-backup.yml` | Nightly database + Storage backup, `age`-encrypted, uploaded to an S3-compatible bucket. Skips cleanly until its secrets exist. Never uploads GitHub artifacts, because the repo is public | Read-only |

**Turning on the nightly backup** (decisions D2, D3, D5):

1. Generate a key pair offline with `age-keygen -o bc-backup.key`. Keep the
   file in two safe places, never in the repo or CI. Its public line
   (`age1…`) is `DR_AGE_RECIPIENT`.
2. Create a bucket at a provider other than Supabase, with versioning or
   object lock, a lifecycle rule for retention (D4), and a **write-only** key.
3. Add the repository secrets listed at the top of the workflow.
   `DR_DATABASE_URL` must be the **session pooler** URI from Supabase →
   Connect. The direct host is IPv6-only on the Free plan, and GitHub's
   runners are IPv4.
4. Actions → DR backup → Run workflow. Check the bucket, then do the restore
   drill in §8 from that backup.

`pnpm db:reset:url` (`scripts/db-push.mjs --reset`, which drops the public
schema) now refuses the production ref unless `DR_ALLOW_PRODUCTION` is set.

**Tool versions matter.** `pg_dump` must be at least the server's major
version, and production is Postgres **17**. Ubuntu 24.04 ships 16. The backup
script checks this and stops rather than producing a bad dump. Install
`postgresql-client-17` or newer from the PostgreSQL apt repository, or use
Homebrew's `libpq` on a Mac.

## 6. Migration safety

Every production migration follows these steps:

1. **One file, one change, in git first.** Add
   `supabase/migrations/<timestamp>_<name>.sql` and apply that exact text to
   production under the same name. Never edit a function in the dashboard.
   `pnpm dr:drift` exists to catch that.
2. **Review for destruction.** Look for `drop`, `truncate`, `delete`/`update`
   without a narrow `where`, `alter type`, column type changes, `create or
   replace` on a function whose `set`/`security` clauses it silently resets
   (see migration 049), and policy or grant changes. Anything destructive gets
   a second reviewer.
3. **Test before production.** Run `pnpm test:db` and `pnpm dr:rehearse`
   locally, then apply to staging if D7 is adopted.
4. **Back up immediately before**: `pnpm dr:backup <dir>`. Add
   `pnpm dr:storage:backup` if the migration touches storage. No backup, no
   migration.
5. **Write the way back first.** For reversible changes, the reverse SQL goes
   in the PR description. For destructive ones, prefer expand/contract: rename
   or stop using the old column or table, deploy, and drop it in a later
   migration once nothing reads it. The "rollback" for a drop that already
   happened is recovering those rows from step 4's backup (runbook §1).
6. **Keep app and schema compatible both ways.** Vercel can roll the app back
   in seconds, but not the database. A migration must not break the currently
   deployed code, and the new code must not need a migration that has not run.
7. **After applying**, run `pnpm dr:drift` against production and record the
   migration in the PR.

**Never run `supabase db push` or `pnpm db:push` against production** until
the migration history is reconciled (§2 item 4). Reconciling means rewriting
`supabase_migrations.schema_migrations` to the repo's versions. That is a
separate, reviewed change.

## 7. Access and audit

Who can currently destroy or restore production:

- **Supabase organisation owners/administrators** can restore, pause, delete
  the project and reset the database password. Review the member list
  (Organization → Team) and enforce MFA (Organization → Security).
- **Anyone holding `SUPABASE_SERVICE_ROLE_KEY`** (Vercel env) bypasses RLS on
  all data and storage.
- **Anyone holding the database password** (`DATABASE_URL`) can do anything
  the backup and restore scripts do.
- **Anyone who can push to the default branch** changes what Vercel deploys.
- **Anyone with Supabase MCP/CLI access** (personal access tokens, the
  connector in `.mcp.json`) can run arbitrary SQL.

Rules:

- Restore and delete rights belong only to the operators named in D8.
- Every backup records who took it (`operator.txt`). Every restore, recovery
  or key rotation gets an entry in the incident log (runbook, top). The log
  records who, when, which backup, the target, and the verify result.
- Backups are encrypted to a key that no automated system holds (D5).
  Whoever runs the schedule can write backups but cannot read them.
- Supabase's own audit log (Organization → Audit logs, paid plans) should be
  exported into the incident log after any recovery.

## 8. Restore test results

A backup is not trusted until a restore from it has been verified. What has
been tested:

**Test 1: production schema vs rebuild from git** (2026-09-27, read-only
against production). All 691 schema objects match. Seven functions differed
only in comments and whitespace, which the fingerprint now ignores. The only
real difference is the platform-created `rls_auto_enable` event trigger. Result:
**rebuilding the schema from the migrations is a verified recovery path.**

**Test 2: full backup → restore → verify, end to end** (`pnpm dr:rehearse`,
local Postgres 16, demo data shaped like production). Results:

| Check | Result |
|---|---|
| Schema objects after restore | 691 / 691 match |
| Tables, row counts and content hashes | 29 / 29 match, 275 rows |
| Foreign keys re-proved row by row | 40 / 40 hold |
| CHECK constraints re-proved row by row | 62 / 62 hold |
| Candidate sees only their own applications (RLS) | pass |
| Anonymous visitor sees no applications (RLS) | pass |
| User cannot make themselves admin (guard trigger) | pass |
| Employer can move an applicant; candidate is notified (triggers) | pass |
| Restore script refuses the production project | pass |

**Test 3: accidental delete, recovered without a full restore.** All 33
applications were deleted. The delete cascaded to 33 application events and
fired 2 spurious withdrawal notifications. Everything was recovered from the
backup's `full.dump` through a scratch database. Afterwards the live
sequences were unchanged, the spurious notifications were removed, and the
database re-verified 100% against the backup.

**Test 4: runbook §1 run literally.** Every command in the runbook's
"database accidentally modified" section was run as written, after deleting
all applications and closing all 15 active jobs. Deleted rows came back by
copy-back, and the jobs came back through the `recovery` schema and the
generated full-column update. Verification then passed 100% against the
backup.

The rehearsals found five problems before they could cost anything:

1. A naive copy-back replays `setval(…, 1)` and rewinds live sequences, so the
   next insert collides with existing ids. The runbook strips those lines.
2. Recovering the table someone named loses cascaded children and leaves
   side-effect notifications. The runbook covers both.
3. Newer `pg_dump` output contains `\restrict` lines that `psql -c` rejects.
   The runbook replays from a file with `-f`.
4. `pg_dump -t recovery.jobs` does not create the `recovery` schema, so the
   first draft's load failed. The runbook now creates it first.
5. Restoring only the damaged column, with triggers on, sent 15 more
   notifications and left `version`/`updated_at` as the damage set them. The
   runbook now generates an all-columns update and runs it with triggers
   off.

**Test 5: rebuild on a real Supabase project** (2026-09-27, throwaway
project `brokersconnect-dr-drill` / `sujhcegllzfyqdggbowh`, same region,
Postgres 17). All 67 migrations were applied in eight transaction-safe
batches, with comments stripped. The fingerprint then matched production on
**all 691 objects**, every per-kind hash identical. Synthetic users were then
written straight into the real `auth.users`, with a profile, a company, a job
and an application. The triggers fired as in production: owner membership,
publication window, notifications, application event. Access checks, run as
each role:

| Check on real Supabase | Result |
|---|---|
| Candidate sees own application | 1 (pass) |
| Another candidate sees it | 0 (pass) |
| Anonymous visitor sees applications | 0 (pass) |
| Employer sees their applicant | 1 (pass) |
| Another candidate sees the applicant's phone | 0 (pass) |
| Employer sees the applicant's profile | 1 (pass) |
| Anonymous visitor sees the active job | 1 (pass) |
| Candidate promotes self to admin | refused by guard trigger (pass) |
| Anonymous visitor reads the email outbox | 0 (pass) |

The project is **paused, not deleted**. The session's tools cannot delete a
project. Delete it in the dashboard (Settings → General → Delete project)
once you have read this.

**Not yet tested:**

- **A restore of real production data into a real Supabase project.** It
  needs the database password, which this session did not have.
  Specifically unproven: loading real `auth.*` rows, including
  `auth.identities`, into a newer auth-server version; email and Google
  sign-in after the move; and the timed RTO. **This is the first drill to
  run** once the nightly backup is configured. Unpause the drill project (or
  make a new one), run `pnpm dr:restore` with that night's backup, then
  `pnpm dr:verify`, and delete the project afterwards.
- `dr:storage:backup` / `dr:storage:restore` against live Storage. They need
  the service-role key. Run them in the same drill.
- Vercel rollback. The project was not visible to this session.

## 9. Remaining risks

- Until the first scheduled backup runs, **any data loss is permanent**.
- The published demo admin password (§2 item 1), confirmed working, on a
  public repository.
- The domain's registrar is unknown, so DNS hijack and expiry recovery are
  unplanned.
- The first real Supabase-to-Supabase restore has not been performed, so its
  RTO is an estimate.
- Restoring `auth` data across auth-server versions is supported by Supabase
  but unproven here. The worst case is that users must reset their passwords.
- Storage deletions made by the app itself (account deletion removes a user's
  CVs and avatars, on purpose) are final by design. Backups hold those files
  until retention expires, which is a privacy obligation as well as a
  recovery asset (D4).
- Dashboard-only configuration (auth settings, email templates, Vercel env
  vars, DNS) is recoverable only from the checklist in the runbook, not from a
  backup.
