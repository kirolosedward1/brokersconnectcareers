# Bringing production up to `main` — September 2026

**State:** prepared and rehearsed; **nothing has been applied to production.**
Applying it needs the owner's go-ahead, a backup, and the steps under
[The release window](#the-release-window).

## Where production stands

Production's migration ledger was read on 2026-09-28 (read-only; the snapshot
is `scripts/release/fixtures/production-ledger-2026-09-28.json`):

- 78 rows, each recorded under the time it was applied rather than its file's
  version. `pnpm db:ledger` matches them to files by name: **72 files are
  applied**, 026 was applied by hand (verified 2026-09-27), and two rows are the
  historical API grants, which have no file. **No drift**: everything production
  runs is in git.
- **25 files are missing:**

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
2. applies the 25 missing files exactly as `pnpm db:apply` will;
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
it just after. With it, **all 25 files apply, the result is identical to
`main`, and the seed and demo data load.**

`pnpm test:release` (in `pnpm check`) keeps this true: it rebuilds production's
order from the snapshot and runs the real `apply` command against it over a
socket, so a new migration that would not apply to production fails CI.

### Not yet verified

Two things need production itself, read-only:

- **The five early files are what production ran.** 316–318 were renumbered and
  rebased when they merged. Their stored text is in
  `supabase_migrations.schema_migrations.statements`; export it
  (`select version, name, statements from supabase_migrations.schema_migrations`)
  and pass it as `--statements`, and the rehearsal replays what was stored
  instead of the file.
- **The rebuild is production.** Run `scripts/dr/fingerprint.sql` on
  production and pass the rows as `--fingerprint`; the rehearsal then says
  whether its starting point matches, object for object, before anything is
  applied on top.

## Data preflight

The rehearsal proves the files apply to production's schema, not to its rows.
A constraint validated as it is added fails on any existing row that breaks it.
`scripts/release/preflight/2026-09-prod-reconciliation.sql` is those
constraints as read-only counts:

- **Blocking — each must be 0**: 069's `email_suppressions_reason_check`, and
  322's two CV-path checks on `applications` and `agent_profiles`. A non-zero
  count means that file would fail and the apply stop there; fix the rows first.
- **Informational**: 307 adds its checks `NOT VALID` and validates what it can,
  leaving a constraint an old row breaks in place for new writes only. A count
  here is the list of rows to clean up afterwards, not a failure.

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

## The release window

Only on the owner's go-ahead.

**Before**

1. Run the preflight on production; the blocking counts must be 0.
2. Export the ledger's statements and production's fingerprint (both
   read-only, above) and run
   `pnpm db:rehearse:ledger --ledger … --statements … --fingerprint …`. It must
   pass *with a verified starting point*.
3. Confirm which commit Vercel is serving and the Vercel plan (the hourly
   housekeeping cron needs Pro), and set `SUPABASE_SERVICE_ROLE_KEY` on Vercel
   — the background jobs and the storage sweep need it.

**In the window**

4. Back up: `pnpm dr:backup <directory outside the repo>` (pg_dump 17 or newer,
   over the **session pooler** URI — the direct host is IPv6-only on the Free
   plan) and `pnpm dr:storage:backup`. No backup, no migration.
5. Deploy `main` to Vercel.
6. Immediately apply. 305 moves two columns the old code reads and the new code
   reads from their new place, so code and schema must not be left apart:

   ```bash
   TARGET_DATABASE_URL='<session pooler URI>' pnpm db:apply                  # the plan
   TARGET_DATABASE_URL='<session pooler URI>' pnpm db:apply --execute --confirm hiwdhicwsohbipxzazmb
   ```

   Alternatively, with the Supabase connector and an explicit go-ahead, the same
   25 files can be applied one `apply_migration` call each, under their file's
   name (307 with its adjustment), which production's name-matched ledger
   already expects.

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
