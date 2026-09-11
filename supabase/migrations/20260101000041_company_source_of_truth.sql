-- One source of truth for "the company I act for", and a billing path that is
-- not blocked by its own guard.
--
-- Migration 15 made a company a team: company_members, with an owner who is
-- always an admin and colleagues who default to 'recruiter'. Row-level
-- security was moved onto membership at the same time — owns_company(),
-- owns_job() and is_company_admin() all read company_members, so any member
-- may read the company's jobs and applicants and insert a job, while only an
-- admin member may edit the company or manage the team.
--
-- Three functions were left reading companies.owner_id. The result is a
-- recruiter who is allowed by the database to do their job and told by the
-- product that they have no company: employer_summary() returns
-- has_company false, so the console shows the "create your company" empty
-- state; employer_trend() draws nothing; claim_monthly_free_post() finds no
-- company at all. The application layer had the same split in four more
-- places, fixed alongside this migration.
--
-- Second defect, proven by calling it as a verified owner:
-- claim_monthly_free_post() always raised "post_credits is set by billing,
-- not by the owner". The function is SECURITY DEFINER, but guard_company_update
-- fires inside it and still sees the caller's JWT, so acting_as_admin() is
-- false and the guard refuses the very credit the function exists to grant.
-- The insert of the grant row rolled back with it, which is why
-- monthly_free_post_grants has never held a row. The guard now recognises the
-- billing path by a transaction-local marker that only a definer function in
-- this schema can set — PostgREST exposes no way for a client to set it —
-- while verification, ownership and the verified stamp stay protected exactly
-- as before.

-- ---------------------------------------------------------------------------
-- The guard: credits may move on the billing path, nothing else may.
-- ---------------------------------------------------------------------------
create or replace function public.guard_company_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;

  -- Never owner-writable, on any path.
  if new.verification_status is distinct from old.verification_status then
    raise exception 'verification_status is set by review, not by the owner';
  end if;
  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by review, not by the owner';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'company ownership cannot be transferred';
  end if;

  -- Credits move only when platform code says it is granting them. The marker
  -- is transaction-local and set inside a SECURITY DEFINER function; a client
  -- speaking to PostgREST has no statement with which to set it.
  if new.post_credits is distinct from old.post_credits
     and coalesce(current_setting('app.granting_credits', true), 'off') <> 'on' then
    raise exception 'post_credits is set by billing, not by the owner';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The free post: found by membership, granted through the marker.
-- ---------------------------------------------------------------------------
create or replace function public.claim_monthly_free_post()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_period  date := date_trunc('month', now())::date;
begin
  -- Membership, not ownership: a recruiter working for a verified company is
  -- as entitled to the company's monthly post as the person who signed up.
  v_company := public.my_company_id();
  if v_company is null then return false; end if;

  if not exists (
    select 1 from companies
    where id = v_company and verification_status = 'verified'
  ) then
    return false;
  end if;

  -- The unique (company_id, period) key is what makes this once a month, and
  -- what makes a double click harmless.
  insert into monthly_free_post_grants (company_id, period)
  values (v_company, v_period)
  on conflict do nothing;

  if not found then return false; end if;

  perform set_config('app.granting_credits', 'on', true);
  update companies set post_credits = post_credits + 1 where id = v_company;
  perform set_config('app.granting_credits', 'off', true);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The two dashboards.
-- ---------------------------------------------------------------------------
create or replace function public.employer_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_result  jsonb;
begin
  v_company := public.my_company_id();
  if v_company is null then return jsonb_build_object('has_company', false); end if;

  select jsonb_build_object(
    'has_company', true,
    'live_jobs', count(*) filter (where j.status = 'active' and (j.expires_at is null or j.expires_at > now())),
    'pending_jobs', count(*) filter (where j.status = 'pending_review'),
    'draft_jobs', count(*) filter (where j.status = 'draft'),
    'expiring_soon', count(*) filter (where j.status = 'active' and j.expires_at is not null and j.expires_at between now() and now() + interval '7 days'),
    'total_views', coalesce(sum(j.view_count), 0),
    'seats_advertised', coalesce(sum(j.seats) filter (where j.status = 'active'), 0)
  ) into v_result
  from jobs j
  where j.company_id = v_company;

  return v_result || jsonb_build_object(
    'applicants_total',   (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company),
    'applicants_new',     (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.status = 'new'),
    'applicants_unseen',  (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.employer_viewed_at is null),
    'applicants_7d',      (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.created_at > now() - interval '7 days'),
    'applicants_prev_7d', (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.created_at between now() - interval '14 days' and now() - interval '7 days'),
    'credits',            (select post_credits from companies where id = v_company),
    'verification',       (select verification_status::text from companies where id = v_company)
  );
end;
$$;

create or replace function public.employer_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_today   date := (now() at time zone 'Africa/Cairo')::date;
  v_days    jsonb;
  v_conv    jsonb;
begin
  v_company := public.my_company_id();
  if v_company is null then return jsonb_build_object('has_company', false); end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('d', to_char(g.day, 'YYYY-MM-DD'), 'applications', coalesce(c.n, 0))
      order by g.day
    ),
    '[]'::jsonb
  ) into v_days
  from generate_series(v_today - 29, v_today, interval '1 day') as g(day)
  left join (
    select (a.created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
    from applications a
    join jobs j on j.id = a.job_id
    where j.company_id = v_company
      and a.created_at >= ((v_today - 29)::timestamp at time zone 'Africa/Cairo')
    group by 1
  ) c on c.day = g.day::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'title_ar', t.title_ar, 'title_en', t.title_en,
        'views', t.view_count, 'applications', t.applications
      )
      order by t.applications::numeric / nullif(t.view_count, 0) desc nulls last, t.applications desc
    ),
    '[]'::jsonb
  ) into v_conv
  from (
    select j.id, j.slug, j.title_ar, j.title_en, j.view_count,
           (select count(*) from applications a where a.job_id = j.id)::int as applications
    from jobs j
    where j.company_id = v_company and j.status = 'active'
    order by j.published_at desc nulls last
    limit 6
  ) t;

  return jsonb_build_object('has_company', true, 'days', v_days, 'conversion', v_conv);
end;
$$;
