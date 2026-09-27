-- =============================================================================
-- 73 — What the directory card said, and what the API said
--
-- Found in the pre-launch QA pass of 27 Sep 2026, both reproduced from outside
-- with nothing but the publishable key every page ships in its JavaScript.
--
-- 1. The number and the CV of a public profile went to anybody.
--
--    get_agent_card() returned `whatsapp_phone` and `cv_path` whenever the card
--    was open, and a `public` card is open to everyone — so an anonymous
--    POST to /rest/v1/rpc/get_agent_card answered with the consultant's
--    WhatsApp number, and the page minted a signed CV link for any reader.
--    Two calls (search_agents for the slugs, then one card each) harvest every
--    public consultant's phone. None of the interface ever offered that: the
--    contact button exists only for somebody with a company, the choice-time
--    hint says a public profile shows your *name*, and the directory's own
--    CTA says to verify a company "to see the name, contact details and CV".
--
--    Now the name and photo still follow `open`, and the number and CV follow
--    `reachable`: somebody hiring (any company member, or an admin), the owner,
--    or a company this consultant applied to. That is exactly who the page
--    already showed a contact button to, so nothing visible changes for anyone
--    who was meant to see it.
--
-- 2. A card with no name had a name in its address.
--
--    Slugs were `<transliterated full name>-<id>`. A consultant who chose
--    "verified employers only" appeared to everybody else as "استشاري عقارات"
--    — and their card linked to /agents/heba-ramadan-625784, in every
--    directory href and in search_agents' answer to anonymous callers. The
--    application now mints `consultant-<8 digits>` (src/lib/slug.ts); this
--    renames every existing profile the same way, because visibility can
--    change after a slug is minted and a public profile today is a gated one
--    tomorrow.
--
--    Old addresses stop resolving. Nothing stored points at them — no
--    notification carries an /agents/ href — and keeping a redirect from the
--    old slug would keep the name reachable, which is the thing being removed.
--
-- Numbered 73 because 68 is taken twice already (search on main, the console
-- on moderation-safety, which runs to 72) and both have reached production or
-- will. Nothing here depends on either.
-- =============================================================================

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
    select
      (public.viewer_has_verified_company() or public.is_admin())  as unlocked,
      -- Somebody hiring: the same test the page uses for its contact button.
      (public.my_company_id() is not null or public.is_admin())    as hiring
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
      ) as open,
      (
        (select hiring from viewer)
        or a.user_id = (select auth.uid())
        or public.applied_to_my_job(a.user_id)
      ) as reachable
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
    c.open                                                         as is_unlocked,
    case when c.open                 then c.full_name      end     as full_name,
    case when c.open                 then c.avatar_url     end     as avatar_url,
    case when c.open and c.reachable then c.whatsapp_phone end     as whatsapp_phone,
    c.headline_ar,
    c.headline_en,
    c.years_experience,
    c.tracks,
    c.district_ids,
    c.languages,
    case when c.open and c.reachable then c.cv_path        end     as cv_path,
    c.availability,
    coalesce(
      (select array_agg(ad.developer_id) from agent_developers ad where ad.agent_id = c.id),
      '{}'::int[]
    )                                                              as developer_ids
  from card c;
$$;

-- Every existing slug, renamed to the shape the application now mints. Only
-- rows not already in that shape, so running this twice changes nothing.
do $$
declare
  r         record;
  candidate text;
begin
  for r in
    select id from agent_profiles where slug !~ '^consultant-[1-9][0-9]{7}$'
  loop
    loop
      candidate := 'consultant-'
        || (1 + floor(random() * 9))::int::text
        || lpad(floor(random() * 10000000)::int::text, 7, '0');
      exit when not exists (select 1 from agent_profiles where slug = candidate);
    end loop;
    update agent_profiles set slug = candidate where id = r.id;
  end loop;
end
$$;
