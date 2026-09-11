-- =============================================================================
-- 43 — Applying is consent, up to the point where it is not
--
-- A candidate who applies hands the employer their name, their WhatsApp
-- number and usually a CV file. `profiles_select_applicants` has said so since
-- migration 04: the owner of the job may read the applicant's profile row.
--
-- agent_profiles was never told. It is gated for the *directory* — public,
-- verified employers only, or hidden — and an application is not a directory
-- view, so the gate answered the wrong question. The applicant card embeds
-- agent_profiles for the headline, years, tracks, districts and sales record,
-- so an employer reading an application they were sent gets the name and the
-- phone number and an empty experience panel between them.
--
-- The fix is narrower than it first looks, because one of the two gated levels
-- is not a mistake:
--
--   verified_employers_only  This is the column default, and verification is a
--                            manual admin action. A consultant who is happy to
--                            be seen by verified employers has said nothing
--                            about the employer they personally applied to —
--                            and applying is the more specific statement of
--                            the two. Today zero applications sit in this
--                            state, but it is the default visibility meeting
--                            the default verification status, so it is where
--                            new signups land.
--
--   hidden                   Not an accident. `hidden` exists so an employed
--                            consultant can stay invisible to the company they
--                            currently work for — and they were very likely
--                            hired through an application to that company, so
--                            opening on an application would defeat the
--                            feature for exactly the person it was built for.
--                            It stays shut. The applicant card explains the
--                            absence instead of rendering a gap.
--
-- So: an application unlocks a profile its owner already shows to verified
-- employers. It does not unlock one they withheld.
-- =============================================================================

-- The predicate, once, so the policy and the card function cannot drift.
--
-- SECURITY DEFINER for the same reason is_candidate() is: the answer must not
-- depend on the caller being able to read `applications` through RLS, which is
-- the very thing it is about to be used to decide.
create or replace function public.applied_to_my_job(p_candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from applications a
     where a.candidate_id = p_candidate
       and public.owns_job(a.job_id)
  );
$$;

-- anon too, and not as an oversight. Postgres ORs every permissive SELECT
-- policy together and evaluates all of them, so a policy calling a function
-- anon cannot execute does not fall through to the next policy — it errors,
-- and /agents stops loading for signed-out visitors. The function answers
-- false for a null auth.uid(), which is the correct answer for anonymous.
revoke execute on function public.applied_to_my_job(uuid) from public;
grant  execute on function public.applied_to_my_job(uuid) to anon, authenticated, service_role;

create policy agent_profiles_select_applicants on agent_profiles
  for select using (visibility <> 'hidden' and public.applied_to_my_job(user_id));

-- ---------------------------------------------------------------------------
-- A consultant directory of consultants
--
-- agent_profiles_write_own checks whose row it is and never what kind of
-- account is writing it — the exact gap migration 15 closed on applications,
-- left open one table over. An employer could list themselves in /agents as a
-- consultant, and search_agents would have shown them: it joins profiles for
-- the name and never looks at the role.
--
-- Nothing in the interface offers this — /dashboard/profile is behind
-- requireCandidate — and production has eight agent rows, all of them
-- candidates. So this closes a door before anyone walks through it rather than
-- cleaning up after them.
-- ---------------------------------------------------------------------------

drop policy if exists agent_profiles_write_own on agent_profiles;

create policy agent_profiles_write_own on agent_profiles
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_candidate());

-- The directory listing: consultants only.
--
-- Restated whole because `create or replace` replaces the whole body — this
-- carries migration 03's shape unchanged apart from the role condition.
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
       and p.role = 'candidate'
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

-- The card, for the employer holding the application.
--
-- The applicant card links to /agents/<slug>, so without the same disjunct the
-- policy above just gained, the panel would fill in and the link beside it
-- would still show an anonymous card. Migration 40 added the owner; this adds
-- the employer they applied to.
--
-- Only the unlock changes, not the row filter: a `verified_employers_only`
-- profile already passes the filter and is merely stripped of its name, phone
-- and CV, and a `hidden` one is excluded a line above and stays excluded.
--
-- Restated whole for the same reason search_agents is — `create or replace`
-- replaces the whole body, so this carries migration 40's, plus
-- `applied_to_my_job` beside `unlocked`, plus the role condition.
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
  ),
  card as (
    select
      a.*,
      p.full_name,
      p.avatar_url,
      p.whatsapp_phone,
      (
        a.visibility = 'public'
        or (select unlocked from viewer)
        or a.user_id = (select auth.uid())
        or public.applied_to_my_job(a.user_id)
      ) as open
    from agent_profiles a
    join profiles p on p.id = a.user_id
    where a.slug = p_slug
      and p.role = 'candidate'
      and (
        a.visibility in ('public', 'verified_employers_only')
        or a.user_id = (select auth.uid())
      )
  )
  select
    c.id,
    c.slug,
    c.open                                              as is_unlocked,
    case when c.open then c.full_name      end          as full_name,
    case when c.open then c.avatar_url     end          as avatar_url,
    case when c.open then c.whatsapp_phone end          as whatsapp_phone,
    c.headline_ar,
    c.headline_en,
    c.years_experience,
    c.tracks,
    c.district_ids,
    c.languages,
    case when c.open then c.cv_path        end          as cv_path,
    c.availability,
    coalesce(
      (select array_agg(ad.developer_id) from agent_developers ad where ad.agent_id = c.id),
      '{}'::int[]
    )                                                   as developer_ids
  from card c;
$$;
