-- =============================================================================
-- 14 — Dashboard trends
--
-- The summaries in migration 13 answer "how many". These answer "which way",
-- and only where a direction is the point: applications arriving over a month,
-- and platform activity over the same window. A credit balance has no shape,
-- so it stays a number on a tile.
--
-- Two rules both functions follow.
--
-- Every day in the window is returned, including the empty ones. A series
-- built by grouping rows skips the days nobody applied, and a chart drawn from
-- that draws a straight line across a quiet week and calls it steady demand.
--
-- Days are Cairo days. The server thinks in UTC, where a day ends at 2am local
-- and an evening's applications land in two different bars.
--
-- Both are SECURITY DEFINER, scoped internally to auth.uid() with no argument
-- naming whose numbers to fetch — the same shape as the summaries.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Employer
--
-- Applications per day, plus how each live listing converts the views it got.
--
-- Conversion is a comparison, not a trend, and it is one deliberately: views
-- are a counter on the listing with no date attached, so there is no history
-- to plot. Ranking today's listings against each other answers the same
-- question — which of these is working — out of data that actually exists.
-- ---------------------------------------------------------------------------

create or replace function public.employer_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_today   date := (now() at time zone 'Africa/Cairo')::date;
  v_days    jsonb;
  v_conv    jsonb;
begin
  select id into v_company from companies where owner_id = auth.uid();

  if v_company is null then
    return jsonb_build_object('has_company', false);
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'd', to_char(g.day, 'YYYY-MM-DD'),
               'applications', coalesce(c.n, 0)
             ) order by g.day
           ),
           '[]'::jsonb
         )
    into v_days
  from generate_series(v_today - 29, v_today, interval '1 day') as g(day)
  left join (
    select (a.created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from applications a
      join jobs j on j.id = a.job_id
     where j.company_id = v_company
       and a.created_at >= ((v_today - 29)::timestamp at time zone 'Africa/Cairo')
     group by 1
  ) c on c.day = g.day::date;

  -- The six most recent live listings, ranked by how well they convert. Recent
  -- rather than best, so the list is about what is running now; a listing with
  -- no views yet sorts last rather than dividing by zero.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',           t.id,
               'slug',         t.slug,
               'title_ar',     t.title_ar,
               'title_en',     t.title_en,
               'views',        t.view_count,
               'applications', t.applications
             )
             order by t.applications::numeric / nullif(t.view_count, 0) desc nulls last,
                      t.applications desc
           ),
           '[]'::jsonb
         )
    into v_conv
  from (
    select j.id, j.slug, j.title_ar, j.title_en, j.view_count,
           (select count(*) from applications a where a.job_id = j.id)::int as applications
      from jobs j
     where j.company_id = v_company
       and j.status = 'active'
     order by j.published_at desc nulls last
     limit 6
  ) t;

  return jsonb_build_object('has_company', true, 'days', v_days, 'conversion', v_conv);
end;
$$;

revoke execute on function public.employer_trend() from public, anon;
grant  execute on function public.employer_trend() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin
--
-- Three series on one window: sign-ups, listings published, applications. They
-- share an axis because the question they answer together is whether the two
-- sides of the marketplace are growing at the same rate — which is invisible
-- when each is a separate number on a separate tile.
-- ---------------------------------------------------------------------------

create or replace function public.admin_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_days  jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'd',            to_char(g.day, 'YYYY-MM-DD'),
               'signups',      coalesce(s.n, 0),
               'published',    coalesce(p.n, 0),
               'applications', coalesce(a.n, 0)
             ) order by g.day
           ),
           '[]'::jsonb
         )
    into v_days
  from generate_series(v_today - 29, v_today, interval '1 day') as g(day)
  left join (
    select (created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from profiles group by 1
  ) s on s.day = g.day::date
  left join (
    select (published_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from jobs where published_at is not null group by 1
  ) p on p.day = g.day::date
  left join (
    select (created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from applications group by 1
  ) a on a.day = g.day::date;

  return jsonb_build_object('days', v_days);
end;
$$;

revoke execute on function public.admin_trend() from public, anon;
grant  execute on function public.admin_trend() to authenticated, service_role;
