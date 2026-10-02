# Bringing production up to `main` — September 2026

**State: applied to production on 2026-09-29**, on the owner's go-ahead, after
the read-only checks [below](#verified-against-production-2026-09-29). Production
now matches `main` object for object; how it was done and what was checked is
under [Applied, 2026-09-29](#applied-2026-09-29).

## Where production stands

Production's migration ledger was read on 2026-09-28 (read-only; the snapshot
is `scripts/release/fixtures/production-ledger-2026-09-28.json`):

- 78 rows, each recorded under the time it was applied rather than its file's
  version. `pnpm db:ledger` matches them to files by name: **72 files are
  applied**, 026 was applied by hand (verified 2026-09-27), and two rows are the
  historical API grants, which have no file. **No drift**: everything production
  runs is in git.
- **29 files are missing** — the 25 of the snapshot day, and 325–328, which
  `main` gained with the moderation work (#28) since:

  | File | What it does |
  | --- | --- |
  | 068 | Search that reads a listing the way people describe it |
  | 069 | What the email provider said happened, and who that may silence |
  | 200 | A notification kind for support replies |
  | 201 | Support requests and a failure reference people can quote |
  | 202 | The directory card and the API stop handing out contact details |
  | 300–302 | One event, one notification; applicant notices folded into one row |
  | 303 | An audit trail and security events |
  | 304 | Contact details on request, with limits |
  | 305 | What an employer may read about an applicant (moves two columns) |
  | 306 | Rate limits that hold under concurrency |
  | 307 | Columns the server owns, checked on the way in |
  | 308 | What a suspended account may still touch |
  | 309 | Storage quotas per folder |
  | 310 | Statement timeouts for the API roles |
  | 311 | Admin actions need a second factor |
  | 312 | A payment is settled against itself |
  | 313 | The admin security overview |
  | 314 | `is_admin()` asked once per query; the home page's counts in one read |
  | 319 | One approval lever after the note moved |
  | 320 | The audit trail asks `is_admin()` once |
  | 322 | The consultant directory is for employers |
  | 323–324 | Background email work that survives a crash |
  | 325 | Notification kinds for moderation decisions |
  | 326 | Reports kept as evidence, with limits that stop them being a weapon |
  | 327 | The moderation console's signals; suspension reasons made private |
  | 328 | Appeals: a second look at a decision |

- **The iOS app's branch (PR #29) adds two more**, so once it merges there are
  **31**: **329**, the phones that receive pushes and the queue they are sent
  from, and **330**, the account-deletion request a company owner can file.
  Both are safe before or after the code (their `-- safety: ships-with-code`
  lines): until they run, the app's push registration fails quietly and an
  owner's deletion request gets the page's old words; nothing else changes.
  The minute push sweep also needs two Vault secrets set by hand
  (`docs/mobile.md`, Pushes).

- **Production ran five files ahead of `main`'s order**: 203, 204, 316, 317 and
  318 were applied on 2026-09-27, before `main` placed 068–202 and 300–314 ahead
  of them. So applying the missing files now runs them in a different order
  than any fresh build of `main` ever has, and the database tests, which build
  from nothing in file order, cannot see what that does.

## The rehearsal

`pnpm db:rehearse:ledger --ledger <ledger.json>` (`scripts/release/rehearse.mjs`)
answers that before anything real runs. In a throwaway in-process Postgres it:

1. rebuilds the database the ledger describes, file by file, **in production's
   own order**;
2. applies the missing files exactly as `pnpm db:apply` will;
3. builds `main` fresh and compares the two, object by object, with
   `scripts/dr/fingerprint.sql` — the same query the disaster-recovery runbook
   uses to prove a restore (columns, constraints, indexes, RLS, policies,
   function bodies, triggers, enums, buckets);
4. loads the seed and the demo data into the result.

**What it found.** One collision, and only one. Migration 307 adds
`reports_detail_length`; 317 later drops it and adds its own version, which is
the one `main` ends with. Production already has 317's, so 307's `add
constraint` fails and rolls 307 back. Replaying the five early files in `main`'s
order was tried as a general cure and is not needed: each was tested, and only
this one constraint depends on the order. (203 is not even safe to re-run.)

**The fix** is one entry in `ADJUSTMENTS` (`scripts/release/migrations.mjs`),
run inside 307's own transaction and recorded in its ledger row beside the
file: drop the constraint just before 307, and put it back exactly as 317 wrote
it just after. With it, **all 29 files apply, the result is identical to
`main`, and the seed and demo data load.** (Re-run after merging 325–328: they
need nothing of their own. 325 only adds enum values, in a transaction of its
own, so they are committed before 326–328 use them. Re-run on 2026-09-28 with
the app's 329 and 330: all 31 apply, and the result is identical.)

`pnpm test:release` (in `pnpm check`) keeps this true: it rebuilds production's
order from the snapshot and runs the real `apply` command against it over a
socket, so a new migration that would not apply to production fails CI.

**After the release.** Production's ledger now records 068–330 under their own
versions, and Supabase lists a ledger by version, so those rows come first,
ahead of everything they ran after. The rehearsal replays a ledger in the order
the database ran it (`replayOrder`; the run of 2026-09-29 is in `APPLY_RUNS`),
and each file `apply` ran with the adjustment it ran with. Without that, it
could not rebuild production at all: 068 met a database with no tables.
`scripts/release/rehearse.test.mjs` checks it on production's ledger read
2026-10-02: the rebuild has production's fingerprint in every kind, and 332–343
apply on top of it and end where `main` does (and so do the files merged since). Without `--ledger` it reads the
ledger of `TARGET_DATABASE_URL`, as `pnpm db:apply` does, and nothing else.

### Verified against production (2026-09-29)

Read-only, through the Supabase connector:

- **The ledger has not moved** since the snapshot: the same 78 rows, the last
  applied on 2026-09-27.
- **The rebuild is production.** `scripts/dr/fingerprint.sql` on production
  and on the rebuild of the snapshot agree kind by kind — the md5 of each
  kind's sorted `name=hash` list is the same for buckets (4), columns (274),
  constraints (184), enums (15), functions (124), indexes (135), policies (93),
  RLS switches (34) and triggers (60). The five early rows stored shorter text
  than their files (re-typed without the comments), and it built the same
  objects, so it needs no replaying. Both sides are read under Supabase's
  search path (`"$user", public, extensions`): outside it, a definition names
  pg_trgm's operator class as `extensions.gin_trgm_ops`, and five indexes would
  differ in print only. `fingerprint()` in the rehearsal does this, so
  `--fingerprint` rows taken on production compare cleanly.
- **Grants**, which the fingerprint leaves out, agree too, with production the
  stricter wherever they differ. EXECUTE matches function for function except
  `is_undeliverable_domain(text)`: production's `refuse_reserved_domains` row
  revokes it from `public`, `anon` and `authenticated`, and its file (029) does
  not. Only definer functions call it, so either way is safe. Table grants
  differ by Supabase's platform defaults, which the in-process database does
  not reproduce.
- **The data preflight** is 0 on every line, blocking and informational.
- **Size**: 17 accounts, about 24 MB, two stored files.
- **Scheduling**: pg_cron and Vault were installed, pg_net was not, and no
  Vault secret is set. The one job was 204's
  `brokersconnect-lifecycle-maintenance` (hourly, at minute 7), which is plain
  SQL. 329 installs pg_net itself where Supabase offers it and schedules the
  minute push sweep, which does nothing until its two Vault secrets are set;
  until then pushes go out from the actions' flush and from Vercel's
  `/api/cron/push`.

## Data preflight

The rehearsal proves the files apply to production's schema, not to its rows.
A constraint validated as it is added fails on any existing row that breaks it.
`scripts/release/preflight/2026-09-prod-reconciliation.sql` is those
constraints as read-only counts:

- **Blocking — each must be 0**: 069's `email_suppressions_reason_check`,
  322's two CV-path checks on `applications` and `agent_profiles`, and 326's
  rule that every report names exactly one target (its authors found no reports
  on production on 2026-09-27; this says whether that still holds). A non-zero
  count means that file would fail and the apply stop there; fix the rows first.
- **Informational**: 307 adds its checks `NOT VALID` and validates what it can,
  leaving a constraint an old row breaks in place for new writes only. A count
  here is the list of rows to clean up afterwards, not a failure. Also the rows
  326 backfills and the suspension reasons 327 moves before its check.

## `pnpm db:apply`

`scripts/release/migrations.mjs apply` replaces `pnpm db:push:url` for any
database that already has data. `db:push:url` re-runs every migration, then
`seed.sql`, then the grants; it is for building an empty database, never for
production.

- Reads the target's own ledger and applies only what is missing, in file
  order, each file in **one transaction together with its ledger row** (the
  file's own version and name, and every statement run, adjustments
  included). A failure rolls that file back and stops: everything before it is
  applied and recorded, nothing after it ran.
- Dry run unless `--execute`; production also needs
  `--confirm hiwdhicwsohbipxzazmb`.
- Refuses a ledger with drift, the transaction pooler (port 6543) and a second
  concurrent run (advisory lock). Each file waits at most five seconds for a
  lock, so the site's traffic is never queued behind a migration.

## Applied, 2026-09-29

PR #29 merged into `main` (2a86853) and Vercel deployed it; the 31 files went
to production right after, through the Supabase connector:

- **Backup first**: `backup_2026_09_29` holds a copy of every `public` table,
  row counts checked against the originals, in a schema the API does not serve.
  Drop it once the release has settled.
- **No SQL re-typed**: pg_net (which 329 installs anyway) let the database
  fetch each file from GitHub at 2a86853; each one's md5 was checked against
  the file here before anything ran.
- **Applied as `pnpm db:apply` does**: one transaction per file, in file order,
  a five-second lock timeout, 307 with its adjustment, and the ledger row with
  the file's own version and every statement run. A helper function did this,
  refusing a file out of order or twice; it was rehearsed on the rebuild of the
  snapshot first, and dropped afterwards. Two calls lost their reply to the
  connector (a gateway 502); the ledger showed neither had applied, and each
  was run again.
- **Checked**: the ledger holds 109 rows (the 31 under their own versions);
  the fingerprint equals a fresh build of `main` in every kind (423 columns, 295
  constraints, 226 functions, 207 indexes, 109 policies, 104 triggers, 52 RLS
  switches, 15 enums, 4 buckets); function grants equal it too, but for
  `is_undeliverable_domain`, still the stricter on production; the cron jobs
  are the lifecycle job and 329's push sweep; the security advisors report no
  errors.
- **Found on the way**: `.vercelignore` said `mobile/`, which matches a
  directory of that name at any depth and so took `src/app/api/mobile/` — the
  app's API — out of every deployment. Now `/mobile/`.

## The release window

Only on the owner's go-ahead.

**Before**

1. Run the preflight on production; the blocking counts must be 0. (Done
   2026-09-29: all 0.)
2. Check that the rebuild is production — the fingerprint, and the ledger
   against the snapshot. (Done 2026-09-29, above; re-check on the day if the
   ledger has moved.)
3. Confirm which commit Vercel is serving and the Vercel plan (`main`'s crons
   run every ten minutes, and the app's push cron every five), and set
   `SUPABASE_SERVICE_ROLE_KEY` on Vercel — the background jobs and the storage
   sweep need it. Vercel builds this branch's previews without complaint.

**In the window**

4. Back up: `pnpm dr:backup <directory outside the repo>` (pg_dump 17 or newer,
   over the **session pooler** URI — the direct host is IPv6-only on the Free
   plan) and `pnpm dr:storage:backup`. No backup, no migration. Through the
   connector alone, the fallback is a copy of every `public` table inside the
   database (`create table backup_2026_09_29.<table> as table public.<table>`,
   in a schema the API does not serve): it guards against a migration that
   mangles rows, which is the risk here, not against losing the project. The
   migrations touch no stored files. Drop the schema once the release has
   settled.
5. Deploy `main` to Vercel.
6. Immediately apply. 305 moves two columns the old code reads and the new code
   reads from their new place, so code and schema must not be left apart:

   ```bash
   TARGET_DATABASE_URL='<session pooler URI>' pnpm db:apply                  # the plan
   TARGET_DATABASE_URL='<session pooler URI>' pnpm db:apply --execute --confirm hiwdhicwsohbipxzazmb
   ```

   Alternatively, with the Supabase connector and an explicit go-ahead, the same
   files (29, or 31 once the app's branch is in `main`) can be applied one
   `apply_migration` call each, under their file's name (307 with its
   adjustment), which production's name-matched ledger already expects.

**After**

7. `pnpm db:ledger` — no pending files, no drift. Then `pnpm dr:drift`,
   `pnpm doctor`, `pnpm smoke https://www.brokersconnect.net`, and the Supabase
   advisors.
8. Generate types from the reconciled database into
   `src/lib/supabase/database.generated.ts`.

**If a file fails**, the apply has already rolled it back and stopped. Read the
error, fix forward (a new migration, or an adjustment reviewed like this one),
rehearse again, and re-run: it picks up from the first file not applied. A
restore from step 4 is for data loss, not for a failed migration.

**Code and schema order.** Every missing file carries a `-- safety:
ships-with-code` line saying which order is safe. Most are safe either way.
Three state a preference, and they pull in opposite directions:

- 300–302 need **the code first**: the old code's notification renderer has no
  icon for the kinds these files add and throws on the first one written.
- 305 prefers **the migration first**: in between, notification email, the
  unsubscribe link and the admin's view of the approval note fail closed for a
  few minutes — nothing is exposed and nothing is lost.
- 312 prefers **the migration first**: in between, a Paymob callback gets a 500
  and is retried until the migration runs (and billing is off unless
  `BILLING_ENABLED=true`).
- 304 and 311 ask for one window: the consultant page is down between the two
  steps, and an admin with a second factor is held at the challenge.

So: **deploy, then apply at once.** The other order breaks pages; this one only
fails closed for the minutes in between.
