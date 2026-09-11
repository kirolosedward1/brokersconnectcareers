-- A consultant can read their own card.
--
-- get_agent_card() decided who sees a name by asking whether the viewer is a
-- verified employer or an admin, and filtered hidden profiles out for
-- everyone. Both rules had no clause for the one reader with an unarguable
-- claim: the person whose card it is. A consultant who set "hidden" got a
-- 404 on their own page, and one on "verified employers only" was shown the
-- anonymous version — so the profile editor had no way to show what it
-- produces, which is roadmap item 06 and the loop that profile completeness
-- never closed.
--
-- Same shape, one more disjunct per gate: the owner is unlocked and the owner
-- passes the visibility filter. Nothing widens for anybody else; RLS already
-- let the owner read every one of these columns directly.
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
    (a.visibility = 'public' or unlocked or a.user_id = auth.uid())                    as is_unlocked,
    case when a.visibility = 'public' or unlocked or a.user_id = auth.uid() then p.full_name      end as full_name,
    case when a.visibility = 'public' or unlocked or a.user_id = auth.uid() then p.avatar_url     end as avatar_url,
    case when a.visibility = 'public' or unlocked or a.user_id = auth.uid() then p.whatsapp_phone end as whatsapp_phone,
    a.headline_ar,
    a.headline_en,
    a.years_experience,
    a.tracks,
    a.district_ids,
    a.languages,
    case when a.visibility = 'public' or unlocked or a.user_id = auth.uid() then a.cv_path        end as cv_path,
    a.availability,
    coalesce(
      (select array_agg(ad.developer_id) from agent_developers ad where ad.agent_id = a.id),
      '{}'::int[]
    )                                                        as developer_ids
  from agent_profiles a
  join profiles p on p.id = a.user_id
  cross join viewer
  where a.slug = p_slug
    and (a.visibility in ('public', 'verified_employers_only') or a.user_id = auth.uid());
$$;
