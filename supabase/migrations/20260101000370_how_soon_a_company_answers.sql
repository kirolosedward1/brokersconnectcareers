-- =============================================================================
-- 370 — How soon a company answers
--
-- The listing in the app (v1.1) says, under the pay, how a company treats the
-- applications it gets: «تردّ هذه الشركة خلال N أيام في المتوسط · فتحت X% من
-- الطلبات». Both from what the database already keeps, over the last 180 days
-- of applications to the company's listings:
--
--   open_rate    the share of them the company opened (employer_viewed_at);
--   median_days  how long the typical one waited for its first answer — the
--                first move off «new» that was not the candidate withdrawing
--                (application_events, migration 42), as a median, so one
--                application left for months does not speak for the rest.
--
-- Aggregates only, never a row: security definer reads what the caller could
-- not, and gives back three numbers. Under five applications it gives back
-- nothing, so no figure is one candidate's story; under three answered ones
-- there is no median. Public, as the listing is: anybody who can read the
-- listing can read how its company answers.
--
-- The app keeps the answer a day per company; it is cheap enough to ask on a
-- listing's first open (indexes: applications_job_id_idx and
-- application_events_application_idx).
--
-- rollback: drop function if exists public.company_response_stats(uuid);
-- safety: additive — a new function, no table or policy changes. An app that
-- asks before this lands gets "function not found" and shows no line.
-- =============================================================================

create or replace function public.company_response_stats(p_company_id uuid)
returns table (sample int, open_rate numeric, median_days numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recent as (
    select a.id, a.created_at, a.employer_viewed_at, a.candidate_id
    from applications a
    join jobs j on j.id = a.job_id
    where j.company_id = p_company_id
      and a.created_at > now() - interval '180 days'
  ),
  answered as (
    select r.id, min(e.created_at) - r.created_at as wait
    from recent r
    join application_events e on e.application_id = r.id
    where e.from_status = 'new'
      and e.to_status <> 'withdrawn'
      and e.actor_id is distinct from r.candidate_id
    group by r.id, r.created_at
  )
  select
    count(*)::int as sample,
    round(avg((r.employer_viewed_at is not null)::int)::numeric, 2) as open_rate,
    (
      select round((percentile_cont(0.5) within group (order by extract(epoch from wait) / 86400))::numeric, 1)
      from answered
      having count(*) >= 3
    ) as median_days
  from recent r
  having count(*) >= 5;
$$;

comment on function public.company_response_stats(uuid) is
  'How a company answers applications, last 180 days: how many, the share it opened, the median days to a first answer. Nothing under five applications; no median under three answered. Aggregates only.';

revoke all on function public.company_response_stats(uuid) from public;
grant execute on function public.company_response_stats(uuid) to anon, authenticated;
