-- =============================================================================
-- 68 — The consultant directory is for the people who hire
--
-- The directory was public. Anybody — a signed-out visitor, another
-- consultant, a scraper — could call search_agents() and page through every
-- listed profile: headline, years, tracks, districts, languages, availability,
-- and for a profile set to `public`, the name, the photo and (through
-- get_agent_card) the WhatsApp number. The row-level policy said the same
-- thing one level down: `agent_profiles_select_public` was `visibility =
-- 'public'`, full stop, so a candidate could read every public consultant's
-- row, their work history, their education and their certifications with a
-- plain PostgREST query.
--
-- The product rule is now the narrower one, and it is a product rule rather
-- than a security fix: a job seeker is not the audience for a directory of
-- job seekers. The directory exists so that a company can find a consultant.
-- So it answers a company — an approved employer account, or an admin — and
-- nobody else. What each company sees inside it is unchanged: an unverified
-- company still gets anonymised cards for `verified_employers_only` profiles
-- and named ones for `public`, a verified company gets names everywhere, and
-- `hidden` stays hidden from everybody but its owner.
--
-- "Approved" and not merely "employer": approval is the platform's word for
-- "may this account act at all" (migration 16), and a suspended employer
-- account keeps its membership rows, so a rule written on membership alone
-- would let a suspended company keep browsing consultants' phone numbers.
--
-- The owner keeps their own card. get_agent_card() has answered its owner
-- since migration 40 so the profile editor can show what it produces, and
-- that stays: it is the one preview a consultant has of what a company sees.
--
-- Every reader of the gate goes through one predicate, written once, so the
-- directory function, the card function, the shortlist and the row policies
-- cannot disagree about who is a directory user. The predicate is granted to
-- anon for the reason migration 43 gives — a policy that calls a function the
-- calling role cannot execute errors rather than falling through — and it
-- answers false to anon, which is the right answer.
--
-- Restated whole, every function, because `create or replace` replaces the
-- whole body and this schema has lost a clause that way three times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The one question: is the caller somebody the directory answers?
-- ---------------------------------------------------------------------------

create or replace function public.can_browse_agent_directory()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin() or public.is_approved_employer();
$$;

revoke execute on function public.can_browse_agent_directory() from public;
grant  execute on function public.can_browse_agent_directory() to anon, authenticated, service_role;

comment on function public.can_browse_agent_directory() is
  'Whether the caller may read the consultant directory: an admin, or an '
  'approved employer account. A candidate, a suspended employer and a stranger '
  'all get false. Every directory read — the listing, the card, the shortlist '
  'and the row policies — goes through this one predicate.';

-- ---------------------------------------------------------------------------
-- The rows themselves: readable by directory users, the owner, an admin, or
-- the employer an applicant applied to. Not by other candidates, not by anon.
-- ---------------------------------------------------------------------------

drop policy if exists agent_profiles_select_public on agent_profiles;
create policy agent_profiles_select_public on agent_profiles
  for select using (
    visibility = 'public'
    and public.can_browse_agent_directory()
  );

drop policy if exists agent_profiles_select_gated on agent_profiles;
create policy agent_profiles_select_gated on agent_profiles
  for select using (
    visibility = 'verified_employers_only'
    and public.viewer_has_verified_company()
    and public.can_browse_agent_directory()
  );

-- agent_profiles_select_own, agent_profiles_select_applicants and
-- agent_profiles_admin are unchanged: the owner, the employer somebody
-- applied to, and an admin are not directory readers and were never gated
-- by the directory rule. agent_developers, agent_experience, agent_education
-- and agent_certifications inherit through `exists (select 1 from
-- agent_profiles …)`, so they close with the two policies above and nothing
-- here has to restate them.

-- ---------------------------------------------------------------------------
-- The listing. Migration 53's body, with the gate on the caller added.
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
set search_path = public, pg_temp
as $$
  with viewer as (
    select public.can_browse_agent_directory()                            as may_browse,
           (public.viewer_has_verified_company() or public.is_admin())    as unlocked
  ),
  matched as (
    select a.*, p.full_name, p.avatar_url
      from agent_profiles a
      join profiles p on p.id = a.user_id
      cross join viewer v
     where v.may_browse
       and a.visibility <> 'hidden'
       and p.role = 'candidate'
       and (p_tracks       is null or a.tracks && p_tracks)
       and (p_district_ids is null or a.district_ids && p_district_ids)
       and (p_availability is null or a.availability = p_availability)
       and (p_min_years    is null or a.years_experience >= p_min_years)
  )
  select
    m.id,
    /*
      The slug is the name transliterated — `ahmed-mahmoud-818804` — so an
      anonymised card that carried it was anonymised in the name column and
      not in the link under it. Withheld with the name; the card links by id
      instead, and get_agent_card() below answers to either.
    */
    case when m.visibility = 'public' or v.unlocked then m.slug       end  as slug,
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

-- No longer a public API. `from public, anon` for the reason migration 60
-- spells out: Supabase's default privileges grant anon explicitly, and a
-- revoke from PUBLIC alone leaves that grant standing.
revoke execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int)
  from public, anon;
grant  execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The card. Migration 43's body, with the caller gated the same way — plus
-- the owner, who has always been able to read their own.
-- ---------------------------------------------------------------------------

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
set search_path = public, pg_temp
as $$
  with viewer as (
    select public.can_browse_agent_directory()                            as may_browse,
           (public.viewer_has_verified_company() or public.is_admin())    as unlocked
  ),
  card as (
    select
      a.*,
      p.full_name,
      p.avatar_url,
      p.whatsapp_phone,
      (
        a.user_id = (select auth.uid())
        or (
          (select may_browse from viewer)
          and (a.visibility = 'public' or (select unlocked from viewer))
        )
        or public.applied_to_my_job(a.user_id)
      ) as open
    from agent_profiles a
    join profiles p on p.id = a.user_id
    -- By slug, or by id: a locked card in the directory is linked by id so
    -- the transliterated name in the slug does not travel with it.
    where (a.slug = p_slug or a.id::text = p_slug)
      and p.role = 'candidate'
      and (
        a.user_id = (select auth.uid())
        or (
          (select may_browse from viewer)
          and a.visibility in ('public', 'verified_employers_only')
        )
        -- The employer an applicant applied to reaches the card behind the
        -- applicant link whatever the directory says, as migration 43 decided
        -- — but never a hidden one.
        or (
          a.visibility <> 'hidden'
          and public.applied_to_my_job(a.user_id)
        )
      )
  )
  select
    c.id,
    -- Withheld with the name, for the reason search_agents() gives.
    case when c.open then c.slug           end          as slug,
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

revoke execute on function public.get_agent_card(text) from public, anon;
grant  execute on function public.get_agent_card(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The shortlist predicate and reader. Migration 60's bodies, with the same
-- gate on the `public` branch so a card is "open" only to somebody the
-- directory answers.
-- ---------------------------------------------------------------------------

create or replace function public.agent_card_is_open(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from agent_profiles a
      join profiles p on p.id = a.user_id
     where a.id = p_agent
       and p.role = 'candidate'
       and a.visibility <> 'hidden'
       and (
         (
           public.can_browse_agent_directory()
           and (a.visibility = 'public' or public.viewer_has_verified_company())
         )
         or public.is_admin()
         or public.applied_to_my_job(a.user_id)
       )
  );
$$;

create or replace function public.saved_agent_cards(
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id               uuid,
  slug             text,
  is_listed        boolean,
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
  saved_at         timestamptz,
  saved_by_name    text,
  total_count      bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    select public.my_company_id() as company,
           public.can_browse_agent_directory() as may_browse,
           (public.viewer_has_verified_company() or public.is_admin()) as unlocked
  ),
  cards as (
    select
      s.agent_id,
      s.created_at,
      a.slug,
      a.headline_ar,
      a.headline_en,
      a.years_experience,
      a.tracks,
      a.district_ids,
      a.languages,
      a.availability,
      p.full_name,
      p.avatar_url,
      sb.full_name as saved_by_name,
      (a.visibility <> 'hidden' and p.role = 'candidate')                      as listed,
      (
        (v.may_browse and (a.visibility = 'public' or v.unlocked))
        or public.is_admin()
        or public.applied_to_my_job(a.user_id)
      ) as open
    from saved_agents s
    join agent_profiles a on a.id = s.agent_id
    join profiles p       on p.id = a.user_id
    cross join viewer v
    left join profiles sb on sb.id = s.saved_by
    where s.company_id = v.company
  )
  select
    c.agent_id                                                     as id,
    -- Only with the name. A consultant who narrowed their visibility after
    -- being saved is still listed, but their slug spells their name.
    case when c.listed and c.open then c.slug  end                 as slug,
    c.listed                                                       as is_listed,
    (c.listed and c.open)                                          as is_unlocked,
    case when c.listed and c.open then c.full_name  end            as full_name,
    case when c.listed and c.open then c.avatar_url end            as avatar_url,
    case when c.listed then c.headline_ar      end                 as headline_ar,
    case when c.listed then c.headline_en      end                 as headline_en,
    case when c.listed then c.years_experience end                 as years_experience,
    case when c.listed then c.tracks           end                 as tracks,
    case when c.listed then c.district_ids     end                 as district_ids,
    case when c.listed then c.languages        end                 as languages,
    case when c.listed then c.availability     end                 as availability,
    c.created_at                                                   as saved_at,
    c.saved_by_name,
    count(*) over ()                                               as total_count
  from cards c
  order by c.created_at desc, c.agent_id
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

-- ---------------------------------------------------------------------------
-- Recording a view. Migration 63's body, answering to an id as well as a
-- slug, since a locked card is now opened by id. my_company_id() is still
-- null for anybody who is not in a company, and a company that is not
-- approved never reaches the page that calls this.
-- ---------------------------------------------------------------------------

create or replace function public.record_agent_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent   uuid;
  v_owner   uuid;
  v_company uuid;
begin
  v_company := public.my_company_id();
  if v_company is null then return; end if;

  select a.id, a.user_id into v_agent, v_owner
    from agent_profiles a
   where a.slug = p_slug or a.id::text = p_slug;

  if v_agent is null then return; end if;

  if v_owner = (select auth.uid()) then return; end if;

  insert into agent_profile_views (agent_id, company_id, day)
  values (v_agent, v_company, (now() at time zone 'Africa/Cairo')::date)
  on conflict do nothing;

  delete from agent_profile_views
   where agent_id = v_agent
     and day < (now() at time zone 'Africa/Cairo')::date - 60;
end;
$$;

comment on policy agent_profiles_select_public on agent_profiles is
  'A public profile is public to the directory''s readers — approved employers '
  'and admins — not to the internet and not to other candidates. See migration 68.';

-- =============================================================================
-- Four more doors on the same corridor, found while closing the first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A suspended employer keeps nothing that was sent to them.
--
-- Suspension (migration 33) takes a company's listings down and stops the
-- account creating anything new. It did not touch what had already arrived:
-- owns_job() resolved through membership alone, so an account an admin had
-- suspended for running a fake listing could still open every application to
-- it — name, WhatsApp number, CV — through /api/cv and the applicant pages,
-- for as long as the rows existed. The reason for suspending somebody is
-- exactly that they should not have those.
--
-- Folded into owns_job() rather than into each policy that calls it, for the
-- reason migration 22 gave when it widened the same function: nine policies
-- reach applicants through this one predicate, and a rule stated once cannot
-- be forgotten in the tenth. owns_company() is deliberately left alone — a
-- *pending* employer must still be able to build the company profile and
-- upload the papers the review is waiting for, and those go through it.
--
-- Migration 22's body, with the standing check in front.
-- ---------------------------------------------------------------------------

create or replace function public.owns_job(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_approved_employer()
     and exists (
       select 1 from jobs j
         join company_members m on m.company_id = j.company_id
        where j.id = target and m.user_id = auth.uid()
     );
$$;

-- ---------------------------------------------------------------------------
-- A public bucket does not need a listing policy.
--
-- `avatars` and `company-logos` are public buckets: a file in them is served
-- from its public URL with no policy consulted. The SELECT policies migration
-- 35 and migration 06 gave them did not make the files readable — they made
-- the buckets *listable*, by anybody, with no session: every account's folder
-- and every photo ever uploaded into it, including the photos of consultants
-- set to `hidden` whose names the directory withholds. Nothing in the product
-- lists either bucket as a stranger; the owner's own policy still lists their
-- own folder, which is the one listing that happens.
-- ---------------------------------------------------------------------------

drop policy if exists "avatars are world readable"       on storage.objects;
drop policy if exists "company logos are world readable" on storage.objects;

-- ---------------------------------------------------------------------------
-- A photo is the account's own photo.
--
-- profiles.avatar_url was a free text column an account could write anything
-- into — profiles_update_self does not name columns and guard_profile_update
-- never looked at this one. The value is rendered as an <img> to every
-- employer who opens the applicant card and to every directory reader, on a
-- site whose policy allows images from any https host, which makes it a
-- tracking pixel that the person being tracked cannot see and did not agree
-- to. Two shapes are the whole of what the product writes: a file in the
-- account's own folder of the avatars bucket, and the picture Google handed
-- over at sign-up. Nothing else is a photo of this person.
--
-- A trigger rather than a CHECK, so that an admin or the service role can
-- still repair a row, and so the storage host is not spelled into the schema.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_avatar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;
  if new.avatar_url is null then return new; end if;
  if tg_op = 'UPDATE' and new.avatar_url is not distinct from old.avatar_url then
    return new;
  end if;

  if new.avatar_url ~ ('^https://[A-Za-z0-9.-]+/storage/v1/object/public/avatars/'
                       || new.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
     or new.avatar_url ~ '^https://lh3\.googleusercontent\.com/[A-Za-z0-9._~%/=-]+$'
  then
    return new;
  end if;

  raise exception 'avatar_url must be a file in the account''s own avatar folder'
    using hint = 'Upload the photo through the account page.';
end;
$$;

revoke execute on function public.guard_profile_avatar() from public, anon, authenticated;

drop trigger if exists profiles_10_guard_avatar on profiles;
create trigger profiles_10_guard_avatar
  before insert or update of avatar_url on profiles
  for each row execute function public.guard_profile_avatar();

-- ---------------------------------------------------------------------------
-- A file path is one folder and one file.
--
-- Migration 48 wrote the CV checks as `cv_path like user_id || '/%'`, which is
-- true of `<uid>/../<somebody else>/cv.pdf`. The application's own prefix
-- checks say the same thing with startsWith(). Storage resolves the path as a
-- URL, and a URL collapses `..` — so the row passes every check while naming
-- another person's file, and the signed URL the page mints for it is minted
-- with the service role. Nobody guesses a path, but paths are not secrets
-- either: an employer sees every applicant's, and they never expire because
-- the files are never deleted.
--
-- Exactly `<owner id>/<one file name>`: no second slash, and the name starts
-- with a letter or digit so `.` and `..` are not names. Every path the
-- product has ever written is `<uid>/<uuid>.<ext>`, which passes; the LIKE
-- constraints are dropped rather than kept beside these, because two
-- statements of one rule is how the weaker one gets relied on.
-- ---------------------------------------------------------------------------

alter table applications  drop constraint if exists applications_cv_is_the_applicants;
alter table agent_profiles drop constraint if exists agent_profiles_cv_is_the_owners;

alter table applications
  add constraint applications_cv_is_the_applicants
  check (cv_path is null or cv_path ~ ('^' || candidate_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$'));

alter table agent_profiles
  add constraint agent_profiles_cv_is_the_owners
  check (cv_path is null or cv_path ~ ('^' || user_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$'));

-- ---------------------------------------------------------------------------
-- Only a candidate applies, whoever is asking.
--
-- applications_insert_candidate says so (migration 15) and applications_admin_all
-- says otherwise: it is a permissive policy with `with check (is_admin())`, and
-- Postgres ORs permissive policies together, so an admin account could apply
-- to a listing through the API and then read it back through the admin
-- policies. The apply page only redirects employers. A trigger, because the
-- rule has to hold for the service role and for an admin alike — the same
-- shape as enforce_agent_is_candidate() one table over.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_applicant_is_candidate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role user_role;
begin
  select role into v_role from profiles where id = new.candidate_id;

  if v_role is distinct from 'candidate' then
    raise exception 'applicant_role'
      using hint = 'Only a candidate account can apply to a listing.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_applicant_is_candidate() from public, anon, authenticated;

drop trigger if exists applications_05_candidate_only on applications;
create trigger applications_05_candidate_only
  before insert on applications
  for each row execute function public.enforce_applicant_is_candidate();

-- ---------------------------------------------------------------------------
-- A bookmark is a candidate's, the way a saved search is (migration 65).
--
-- saved_jobs_own checked whose row it was and never what kind of account was
-- writing it. The only page that lists bookmarks sends employers away, so an
-- employer who pressed "save" on a listing got a row they could never see or
-- remove. Split into a read/delete half every owner keeps and an insert half
-- only a candidate may use, and the rows employers already hold are deleted
-- for the reason migration 65 gives: unreachable state is worse than none.
-- ---------------------------------------------------------------------------

delete from saved_jobs s
 using profiles p
 where p.id = s.candidate_id
   and p.role <> 'candidate';

drop policy if exists saved_jobs_own on saved_jobs;

create policy saved_jobs_owner_select on saved_jobs
  for select using (candidate_id = (select auth.uid()));

create policy saved_jobs_owner_delete on saved_jobs
  for delete using (candidate_id = (select auth.uid()));

create policy saved_jobs_owner_insert on saved_jobs
  for insert with check (
    candidate_id = (select auth.uid())
    and public.current_role_of_user() = 'candidate'
  );

-- ---------------------------------------------------------------------------
-- A listing is edited by an employer in good standing.
--
-- owns_job() above now requires an approved account, so a suspended employer
-- lost their applicants and their applicants' numbers. jobs_update_owner did
-- not say the same thing: membership alone let a suspended account keep
-- editing and closing the company's adverts through the API while the console
-- showed them the suspension notice. The read stays — the console has to be
-- able to say what happened to their listings — and the write goes to the same
-- rule as everything else an employer does on a listing.
-- ---------------------------------------------------------------------------

drop policy if exists jobs_update_owner on jobs;
create policy jobs_update_owner on jobs
  for update using (public.owns_company(company_id) and public.is_approved_employer())
  with check (public.owns_company(company_id) and public.is_approved_employer());
