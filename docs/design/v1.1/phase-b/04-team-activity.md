# 04 · Team activity log with export

Board: **TeamActivity**. Who did what in the company: moved an applicant,
revealed a contact, posted or closed a listing, invited or removed someone,
bought a pack. Filterable, and exportable as CSV.

## What exists

- `audit_log` (migration 303) records decisions by the table they changed,
  for admins.
- `application_events` (42), `application_notes` (58),
  `agent_contact_reveals` (304) and `orders` each hold their own part.
  Companies cannot read `agent_contact_reveals` today (only the subject and
  admins can).

## Proposal

No new table. Use one read-only function over what is already recorded:

```sql
create or replace function public.company_activity(
  p_since timestamptz, p_until timestamptz,
  p_member uuid default null, p_kinds text[] default null,
  p_before_id text default null, p_limit int default 50)
returns table (id text, at timestamptz, actor_id uuid, actor_name text,
               kind text, subject_type text, subject_id text, summary jsonb)
language sql stable security definer set search_path = public ...
```

- Callable only by the company's owner and members with the `admin` role.
  It returns only the caller's company's rows.
- Kinds: `application_moved`, `note_added`, `contact_revealed` (the company's
  own reveals: viewer and consultant name, never the number), `job_submitted`,
  `job_closed`, `member_invited`, `member_removed`, `order_paid`.
- Keyset paging on `(at, id)`.

Export: a website GET route `/api/employer/activity.csv?since=&until=` that
streams the same function. The app hands the file to the share sheet, as it
does with the account export.

rollback: drop the function and the route. safety: read-only.

## Decisions (2026-10-30)

1. A company sees **6 months** of activity.
2. Recruiters see **their own activity only**.

## Built (2026-10-30)

The proposal changed in one way: **a table, not a read over the sources.**
Nothing recorded who submitted, closed or reopened a listing (audit_log keeps
only a moderator's decisions), and a reveal is kept 90 days (migration 338)
while the company keeps six months.

- **Migration 377, `company_activity`.**
  - Written by triggers on the tables themselves, so no door around the
    website's actions skips it. The tables are application events, both
    kinds of notes, interview invitations, reveals, listings, team
    membership and paid orders.
  - Only a member's own moves are recorded. A candidate withdrawing or a
    moderator approving is not the team's.
  - A row holds ids and a small detail (a status, a role, a pack). It never
    holds a name, a note's words or a number. Names are read when the log is
    read, so a deleted account is not kept by name.
  - A trigger that fails only raises a warning. The change it records still
    commits.
  - Read only through `company_activity_page()`:
    - Admins (the owner is one) read everyone's and may narrow it to one
      member.
    - Anybody else on the team reads their own, whatever they ask for
      (decided).
    - Keyset pages on (time, id); six months.
  - `purge_company_activity()` runs nightly where pg_cron exists.
  - Test: `supabase/tests/company-activity.test.mjs`.
- **Export:** `src/lib/csv.ts` (shared):
  - A byte-order mark so Excel reads Arabic.
  - CRLF line endings and RFC 4180 quoting.
  - A cell that begins as a formula would (`=`, `+`, `-`, `@`) gets an
    apostrophe first.
  - The app builds the file from the same function, in pages of 500. It
    writes it to the cache, hands it to the share sheet and deletes it. The
    website's GET route waits for the website's activity page.
  - Test: `scripts/csv.test.mjs`.
- **App:** «نشاط الفريق» opens from the company page, at `/employer/activity`.
  - Each entry says what was done, about whom, by whom and when, in Cairo
    time.
  - Admins can filter by member.
  - «مشاركة كجدول» shares the file.
