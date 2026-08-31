-- =============================================================================
-- 03 — Helper functions and triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RLS helpers. All SECURITY DEFINER so that policies on `profiles` /
-- `companies` can consult those same tables without recursing into their own
-- policies. search_path is pinned to defeat search_path hijacking.
-- ---------------------------------------------------------------------------

create or replace function public.current_role_of_user()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

create or replace function public.owns_company(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from companies where id = target and owner_id = auth.uid());
$$;

create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from companies where owner_id = auth.uid() limit 1;
$$;

-- Drives the `verified_employers_only` gate on the agent directory.
create or replace function public.viewer_has_verified_company()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from companies
    where owner_id = auth.uid() and verification_status = 'verified'
  );
$$;

create or replace function public.owns_job(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from jobs j join companies c on c.id = j.company_id
    where j.id = target and c.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Job lifecycle
-- ---------------------------------------------------------------------------

-- Every job expires at 30 days. Stamp published_at/expires_at the moment a job
-- first becomes active; clear them when it leaves the active state.
create or replace function public.stamp_job_publication()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.published_at := coalesce(new.published_at, now());
    new.expires_at   := coalesce(new.expires_at, new.published_at + interval '30 days');
  end if;

  -- Re-opening an expired post starts a fresh 30-day window.
  if tg_op = 'UPDATE' and new.status = 'active' and old.status = 'expired' then
    new.published_at := now();
    new.expires_at   := now() + interval '30 days';
  end if;

  if new.is_featured and new.featured_until is null then
    new.featured_until := now() + interval '14 days';
  end if;

  return new;
end;
$$;

-- Postgres fires BEFORE triggers in name order, and whichever one raises first
-- decides the error the user sees. The numeric prefixes fix that order
-- deliberately: authorisation (10) speaks before the business rule (20), which
-- speaks before derived fields are stamped (30).
create trigger jobs_30_stamp_publication
  before insert or update on jobs
  for each row execute function public.stamp_job_publication();

-- Unverified employers are capped at 1 active post.
create or replace function public.enforce_active_post_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status verification_status;
  v_active int;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;                                  -- already counted
  end if;

  select verification_status into v_status from companies where id = new.company_id;

  if v_status <> 'verified' then
    select count(*) into v_active
      from jobs
     where company_id = new.company_id
       and status = 'active'
       and id <> new.id;

    if v_active >= 1 then
      raise exception 'unverified_company_post_cap'
        using hint = 'Unverified companies may keep only one active job post.';
    end if;
  end if;

  return new;
end;
$$;

create trigger jobs_20_enforce_post_cap
  before insert or update on jobs
  for each row execute function public.enforce_active_post_cap();

-- Nightly cron target: active -> expired. Returns how many it flipped.
create or replace function public.expire_stale_jobs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update jobs
     set status = 'expired'
   where status = 'active'
     and expires_at is not null
     and expires_at <= now();
  get diagnostics n = row_count;

  update jobs
     set is_featured = false
   where is_featured
     and featured_until is not null
     and featured_until <= now();

  return n;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and revoking
-- from anon/authenticated does not remove that. Without the revoke from public,
-- any signed-in user could expire every live listing on the board.
revoke execute on function public.expire_stale_jobs() from public;
revoke execute on function public.expire_stale_jobs() from anon, authenticated;

-- View counter. SECURITY DEFINER so anonymous visitors can bump it without
-- being given UPDATE on jobs.
create or replace function public.increment_job_view(job_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update jobs set view_count = view_count + 1
   where slug = job_slug and status = 'active';
$$;

grant execute on function public.increment_job_view(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Agent directory: anonymised listing
--
-- RLS on agent_profiles hides gated rows outright, which is correct for the
-- detail page but would leave the directory empty. This function is the one
-- sanctioned way to read gated rows, and it strips identity itself.
-- ---------------------------------------------------------------------------

create or replace function public.search_agents(
  p_tracks       job_track[] default null,
  p_district_ids int[]       default null,
  p_availability agent_availability default null,
  p_min_years    int         default null,
  p_limit        int         default 24,
  p_offset       int         default 0
)
returns table (
  id               uuid,
  slug             text,
  is_unlocked      boolean,
  full_name        text,
  avatar_url       text,
  headline_ar      text,
  headline_en      text,
  years_experience int,
  tracks           job_track[],
  district_ids     int[],
  languages        text[],
  availability     agent_availability,
  total_count      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select (public.viewer_has_verified_company() or public.is_admin()) as unlocked
  ),
  matched as (
    select a.*, p.full_name, p.avatar_url
      from agent_profiles a
      join profiles p on p.id = a.user_id
     where a.visibility <> 'hidden'
       and (p_tracks       is null or a.tracks && p_tracks)
       and (p_district_ids is null or a.district_ids && p_district_ids)
       and (p_availability is null or a.availability = p_availability)
       and (p_min_years    is null or a.years_experience >= p_min_years)
  )
  select
    m.id,
    m.slug,
    (m.visibility = 'public' or v.unlocked)                                as is_unlocked,
    case when m.visibility = 'public' or v.unlocked then m.full_name  end  as full_name,
    case when m.visibility = 'public' or v.unlocked then m.avatar_url end  as avatar_url,
    m.headline_ar,
    m.headline_en,
    m.years_experience,
    m.tracks,
    m.district_ids,
    m.languages,
    m.availability,
    count(*) over ()                                                       as total_count
  from matched m cross join viewer v
  order by m.years_experience desc, m.created_at desc
  limit greatest(1, least(p_limit, 60)) offset greatest(0, p_offset);
$$;

grant execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verified companies get one free single post per month, permanently.
-- ---------------------------------------------------------------------------

create or replace function public.claim_monthly_free_post()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_period  date := date_trunc('month', now())::date;
begin
  select id into v_company
    from companies
   where owner_id = auth.uid() and verification_status = 'verified';

  if v_company is null then
    return false;
  end if;

  insert into monthly_free_post_grants (company_id, period)
  values (v_company, v_period)
  on conflict do nothing;

  if not found then
    return false;                                -- already claimed this month
  end if;

  update companies set post_credits = post_credits + 1 where id = v_company;
  return true;
end;
$$;

grant execute on function public.claim_monthly_free_post() to authenticated;

-- Single-profile counterpart to search_agents(), so /agents/[slug] can tell
-- "gated" apart from "does not exist" without leaking the gated fields.
create or replace function public.get_agent_card(p_slug text)
returns table (
  id               uuid,
  slug             text,
  is_unlocked      boolean,
  full_name        text,
  avatar_url       text,
  whatsapp_phone   text,
  headline_ar      text,
  headline_en      text,
  years_experience int,
  tracks           job_track[],
  district_ids     int[],
  languages        text[],
  cv_path          text,
  availability     agent_availability,
  developer_ids    int[]
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select (public.viewer_has_verified_company() or public.is_admin()) as unlocked
  )
  select
    a.id,
    a.slug,
    (a.visibility = 'public' or unlocked)                    as is_unlocked,
    case when a.visibility = 'public' or unlocked then p.full_name      end as full_name,
    case when a.visibility = 'public' or unlocked then p.avatar_url     end as avatar_url,
    case when a.visibility = 'public' or unlocked then p.whatsapp_phone end as whatsapp_phone,
    a.headline_ar,
    a.headline_en,
    a.years_experience,
    a.tracks,
    a.district_ids,
    a.languages,
    case when a.visibility = 'public' or unlocked then a.cv_path        end as cv_path,
    a.availability,
    coalesce(
      (select array_agg(ad.developer_id) from agent_developers ad where ad.agent_id = a.id),
      '{}'::int[]
    )                                                        as developer_ids
  from agent_profiles a
  join profiles p on p.id = a.user_id
  cross join viewer
  where a.slug = p_slug
    and (a.visibility = 'public' or (a.visibility = 'verified_employers_only'));
$$;

grant execute on function public.get_agent_card(text) to anon, authenticated;
