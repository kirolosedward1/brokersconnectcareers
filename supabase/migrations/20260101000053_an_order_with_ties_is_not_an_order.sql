-- =============================================================================
-- 53 — A directory page that can show one consultant twice
--
-- search_agents orders by `years_experience desc, created_at desc` and
-- paginates with limit/offset. Both keys can tie — years by design, since it
-- is a small integer most people share, and created_at the moment two people
-- finish onboarding in the same instant.
--
-- An order with ties is not an order. Postgres is free to return tied rows in
-- a different sequence for the query that builds page one and the query that
-- builds page two, and when it does, one consultant appears on both pages and
-- another appears on neither. Nothing on production ties today; that is a fact
-- about eight rows, not about the function.
--
-- `a.id` last, which cannot tie. Restated whole because `create or replace`
-- replaces the whole body — this carries migration 43's, with one line added
-- to the order.
-- =============================================================================

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
  order by m.years_experience desc, m.created_at desc, m.id
  limit greatest(1, least(p_limit, 60)) offset greatest(0, p_offset);
$$;
