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

## Decisions needed

1. How far back may a company see? Recommended: 12 months.
2. Should recruiters see their own activity? Recommended: yes, filtered to
   themselves.
