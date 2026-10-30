-- =============================================================================
-- 382 — Views, day by day
--
-- docs/design/v1.1/phase-b/10 (Listing performance). The platform kept a
-- listing's views as one total (jobs.view_count), so the stats screen could
-- draw applications day by day but not views. job_view_days counts them per
-- Cairo day, written where the total is: increment_job_view(), restated from
-- migration 3 with the one insert added. The total stays as it was.
--
-- Read by the listing's company (owns_job), as its applications are. Rows go
-- with the listing.
--
-- Tested in supabase/tests/job-view-days.test.mjs.
--
-- rollback: restate increment_job_view() from migration 3; drop table if exists job_view_days;
-- safety: additive — the total is counted exactly as before; a day's row is one more write beside it.
-- =============================================================================

create table if not exists job_view_days (
  job_id uuid not null references jobs(id) on delete cascade,
  day    date not null,
  views  int not null default 0 check (views >= 0),
  primary key (job_id, day)
);

alter table job_view_days enable row level security;
revoke all on job_view_days from anon;
grant select on job_view_days to authenticated;

create policy job_view_days_company_read on job_view_days
  for select to authenticated using (public.owns_job(job_id));

create or replace function public.increment_job_view(job_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  with counted as (
    update jobs set view_count = view_count + 1
     where slug = job_slug and status = 'active'
    returning id
  )
  insert into job_view_days (job_id, day, views)
  select id, (now() at time zone 'Africa/Cairo')::date, 1 from counted
  on conflict (job_id, day) do update set views = job_view_days.views + 1;
$$;

revoke execute on function public.increment_job_view(text) from public, anon, authenticated;
grant  execute on function public.increment_job_view(text) to service_role;
