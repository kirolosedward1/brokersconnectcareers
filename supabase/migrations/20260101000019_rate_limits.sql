-- =============================================================================
-- 19 — Nothing throttled anything
--
-- Two write paths were open to anyone who could reach the API.
--
-- Reports were the worse of the two. The insert policy read
--
--     with check (reporter_id = auth.uid() or reporter_id is null)
--
-- so a signed-out visitor could file them, unlimited, with nothing stopping
-- the same listing being reported a thousand times. They land in
-- /admin/reports, which is a page a person reads by hand — the one queue on
-- the site with no automation behind it and therefore the one worth flooding.
--
-- Applications were milder but the same shape: `unique (job_id, candidate_id)`
-- already prevented applying to one listing twice, and nothing prevented
-- applying to every listing on the board in a loop.
--
-- Counted from the rows themselves rather than from a rate_limits table. Both
-- of these actions leave a durable, timestamped row as their whole purpose, so
-- that row *is* the ledger: it cannot drift from the thing it is counting, it
-- needs no cleanup job, and it survives a restore. A separate counter table
-- earns its place only for actions that leave nothing behind — a password
-- reset request, a failed sign-in — and none of those exist yet.
--
-- Both caps are deliberately loose. They are not a quota; the honest user
-- should never discover them. They exist so that a script gives up.
-- =============================================================================

-- ---------------------------------------------------------------- reports ---

-- A report is now something an account does. Anonymous reporting sounds
-- friendlier and is unworkable: there is nobody to rate-limit, nobody to ask a
-- follow-up question, and nobody who can be wrong twice.
--
-- Historical rows keep their null reporter_id — reporter_id is
-- `on delete set null`, so a deleted account's report stays in the queue
-- without the account. Nulls are distinct in a unique index, so those rows
-- neither collide with each other nor block the new constraint.
drop policy if exists reports_insert_any on reports;

create policy reports_insert_signed_in on reports
  for insert with check (reporter_id = auth.uid());

create unique index if not exists reports_one_per_reporter_per_job
  on reports (job_id, reporter_id);

create index if not exists reports_reporter_recent_idx
  on reports (reporter_id, created_at desc);

create or replace function public.enforce_report_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- One listing per report is already the unique index above, so reaching ten
  -- means ten different listings in a day. A reader who does that is not
  -- reading.
  v_daily_cap constant int := 10;
  v_recent int;
begin
  if new.reporter_id is null then
    return new;
  end if;

  select count(*) into v_recent
    from reports
   where reporter_id = new.reporter_id
     and created_at > now() - interval '1 day';

  if v_recent >= v_daily_cap then
    raise exception 'report_rate_limit'
      using hint = 'Too many reports from this account today. Try again tomorrow.';
  end if;

  return new;
end;
$$;

create trigger reports_10_enforce_rate
  before insert on reports
  for each row execute function public.enforce_report_rate();

-- ----------------------------------------------------------- applications ---

create or replace function public.enforce_application_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A serious week of job hunting is a handful of applications a day. Thirty
  -- is far past determined and well short of a loop.
  v_daily_cap constant int := 30;
  v_recent int;
begin
  select count(*) into v_recent
    from applications
   where candidate_id = new.candidate_id
     and created_at > now() - interval '1 day';

  if v_recent >= v_daily_cap then
    raise exception 'application_rate_limit'
      using hint = 'Too many applications from this account today. Try again tomorrow.';
  end if;

  return new;
end;
$$;

create trigger applications_10_enforce_rate
  before insert on applications
  for each row execute function public.enforce_application_rate();
