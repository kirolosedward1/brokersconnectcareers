-- =============================================================================
-- 20260101000322 — The directory is for employers
--
-- The consultant directory was public. Anybody — a signed-out visitor, another
-- consultant, a scraper — could call search_agents() and page through every
-- listed profile: headline, years, tracks, districts, languages, availability,
-- and for a profile set to `public`, the name and the photo; and the row
-- policy said the same thing one level down, so a candidate could read every
-- public consultant's row, work history, education and certifications with a
-- plain PostgREST query.
--
-- The product rule is now the narrower one, and it is a product rule rather
-- than a security fix: a job seeker is not the audience for a directory of
-- job seekers. The directory exists so that a company can find a consultant.
-- So it answers a company — an approved employer account, or an admin — and
-- nobody else. What each company sees inside it is what migration 304 left:
-- an unverified company gets anonymised cards for `verified_employers_only`
-- profiles and named ones for `public`, a verified company gets names
-- everywhere, `hidden` stays hidden from everybody but its owner, and the
-- number never sits on a card — it comes from reveal_agent_contact(), which
-- already asks for a company in good standing.
--
-- "Approved" and not merely "employer": approval is the platform's word for
-- "may this account act at all" (migration 16), and a suspended employer
-- account keeps its membership rows.
--
-- The owner keeps their own card. get_agent_card() has answered its owner
-- since migration 40 so the profile editor can show what it produces, and
-- that stays: it is the one preview a consultant has of what a company sees.
--
-- Every reader of the gate goes through one predicate, written once, so the
-- directory function, the card function, the view recorder and the row
-- policies cannot disagree about who is a directory user. The predicate is
-- granted to anon for the reason migration 43 gives — a policy that calls a
-- function the calling role cannot execute errors rather than falling through
-- — and it answers false to anon, which is the right answer.
--
-- Restated whole, every function, from the bodies migration 304 left them
-- with, because `create or replace` replaces the whole body and this schema
-- has lost a clause that way three times.
--
-- rollback: forward-fix only — the change is who may read the directory and
--   its cards, plus two CHECK constraints on cv_path, a trigger on
--   profiles.avatar_url, a trigger on applications and the bookmark policies.
--   Undoing it means re-granting search_agents and get_agent_card to anon and
--   restating their migration-304 bodies, which is exactly the exposure this
--   migration exists to close; a fault in it is fixed forward, and the policy
--   suite (supabase/tests/policies.test.mjs, "the agent directory gate") is
--   the check that it did what it says.
-- safety: rls — every rewritten policy narrows, never widens: agent_profiles
--   reads gain the directory gate (approved employer or admin; the owner, an
--   admin and the employer somebody applied to keep their own policies),
--   saved_jobs is split so only a candidate may insert, jobs_update_owner adds
--   the approved-employer test owns_job() already makes; verified by the
--   policy suite as anon, candidate, pending/suspended/unverified/verified
--   employer and admin.
-- safety: grant — can_browse_agent_directory() is a predicate returning a
--   boolean about the caller and reads nothing; anon must be able to call it
--   because the agent_profiles policies call it (an ungranted function in a
--   policy errors rather than fails closed, migration 43). Nothing else here
--   is granted to anon; search_agents and get_agent_card lose their anon grant.
-- safety: revoke-anon — the revoke from public on can_browse_agent_directory()
--   is followed by an explicit grant to anon on the next line, on purpose,
--   for the reason above; search_agents and get_agent_card are revoked from
--   public AND anon explicitly.
-- safety: constraint — the cv_path CHECKs (<owner uuid>/<file>) describe the
--   only shape the app has ever written (isOwnedPath, apply-form and
--   profile-form uploads); a row that fails them could only have come from a
--   crafted request, and the constraint is what refuses the next one. Both
--   tables are small; the check runs in the same transaction as the drop.
-- safety: ships-with-code — the app guards /agents with requireDirectoryViewer
--   and reads the same functions with the same signatures, so new code on the
--   old schema is guarded by the app while the database is still open, and
--   old code on the new schema shows the anonymous directory page a database
--   error on a page the release removes from anonymous reach; neither order
--   loses or exposes data.
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
  'all get false. Every directory read — the listing, the card, the view '
  'recorder and the row policies — goes through this one predicate.';

-- ---------------------------------------------------------------------------
-- The rows themselves: readable by directory users, the owner, an admin, or
-- the employer an applicant applied to. Not by other candidates, not by anon.
-- ---------------------------------------------------------------------------

-- The helpers are asked once per statement, as `(select …)`, the way
-- migration 314 rewrote every policy before this one: each is STABLE and
-- takes no argument, so the answer is the same for every row of the scan.
drop policy if exists agent_profiles_select_public on agent_profiles;
create policy agent_profiles_select_public on agent_profiles
  for select using (
    visibility = 'public'
    and (select public.can_browse_agent_directory())
  );

drop policy if exists agent_profiles_select_gated on agent_profiles;
create policy agent_profiles_select_gated on agent_profiles
  for select using (
    visibility = 'verified_employers_only'
    and (select public.viewer_has_verified_company())
    and (select public.can_browse_agent_directory())
  );

comment on policy agent_profiles_select_public on agent_profiles is
  'A public profile is public to the directory''s readers — approved employers '
  'and admins — not to the internet and not to other candidates. See migration 322.';

-- agent_profiles_select_own, agent_profiles_select_applicants and
-- agent_profiles_admin are unchanged: the owner, the employer somebody
-- applied to, and an admin are not directory readers and were never gated
-- by the directory rule. agent_developers, agent_experience, agent_education
-- and agent_certifications inherit through `exists (select 1 from
-- agent_profiles …)`, so they close with the two policies above and nothing
-- here has to restate them.

-- ---------------------------------------------------------------------------
-- Is a card open to this viewer? Migration 304's body, with the gate on the
-- directory branch. The owner and an admin are as before.
-- ---------------------------------------------------------------------------

create or replace function public.agent_card_open_to_viewer(p_agent uuid)
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
       and (
         a.user_id = (select auth.uid())
         or public.is_admin()
         or (
           public.can_browse_agent_directory()
           and a.visibility <> 'hidden'
           and p.role = 'candidate'
           and p.approval_status = 'approved'
           and (
             a.visibility = 'public'
             or public.viewer_has_verified_company()
             or public.applied_to_my_job(a.user_id)
           )
         )
       )
  );
$$;

revoke execute on function public.agent_card_open_to_viewer(uuid) from public, anon;
grant  execute on function public.agent_card_open_to_viewer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The card. Migration 304's body — no phone, no CV path, `has_cv` and
-- `can_reveal` instead — answering the directory's readers, the owner and an
-- admin, and nobody else. The employer somebody applied to is a directory
-- reader already (an approved employer), so the consent path is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.get_agent_card(p_handle text)
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
  developer_ids    int[],
  has_cv           boolean,
  can_reveal       boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with card as (
    select
      a.*,
      p.full_name,
      p.avatar_url,
      public.agent_card_open_to_viewer(a.id) as open,
      (a.user_id = (select auth.uid())) as is_owner
    from agent_profiles a
    join profiles p on p.id = a.user_id
    where p.role = 'candidate'
      and (
        a.slug = p_handle
        or a.id = case
          when p_handle ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then p_handle::uuid
        end
      )
      -- The directory's readers, the owner, or an admin: nobody else gets a
      -- row, anonymised or otherwise.
      and (
        a.user_id = (select auth.uid())
        or public.is_admin()
        or public.can_browse_agent_directory()
      )
      -- A suspended consultant is off the directory entirely; the owner may
      -- still open their own page and read the state it is in.
      and (
        (p.approval_status = 'approved' and a.visibility in ('public', 'verified_employers_only'))
        or a.user_id = (select auth.uid())
        or public.is_admin()
      )
  )
  select
    c.id,
    -- The handle a locked card is known by is its id, not the name.
    case when c.open then c.slug else c.id::text end       as slug,
    c.open                                                 as is_unlocked,
    case when c.open then c.full_name  end                 as full_name,
    case when c.open then c.avatar_url end                 as avatar_url,
    c.headline_ar,
    c.headline_en,
    c.years_experience,
    c.tracks,
    c.district_ids,
    c.languages,
    c.availability,
    coalesce(
      (select array_agg(ad.developer_id) from agent_developers ad where ad.agent_id = c.id),
      '{}'::int[]
    )                                                      as developer_ids,
    (c.cv_path is not null)                                as has_cv,
    -- Who may ask: somebody acting for a company in good standing, the owner,
    -- or an admin — and only on an open card.
    (
      c.open
      and (
        c.is_owner
        or public.is_admin()
        or (public.my_company_id() is not null and public.is_approved_employer())
      )
    )                                                      as can_reveal
  from card c;
$$;

-- No longer a public API. `from public, anon` for the reason migration 60
-- spells out: Supabase's default privileges grant anon explicitly, and a
-- revoke from PUBLIC alone leaves that grant standing.
revoke execute on function public.get_agent_card(text) from public, anon;
grant  execute on function public.get_agent_card(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The listing. Migration 304's body — the keyword, the anonymous handle on a
-- locked card, the offset ceiling — with the gate on the caller added.
-- ---------------------------------------------------------------------------

create or replace function public.search_agents(
  p_tracks       job_track[] default null,
  p_district_ids int[]       default null,
  p_availability agent_availability default null,
  p_min_years    int         default null,
  p_limit        int         default 24,
  p_offset       int         default 0,
  p_q            text        default null
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
  needles as (
    -- At most eight words, each folded the way the text is.
    select array(
      select w
        from unnest(string_to_array(
               public.ar_strip_al(public.ar_normalise(left(coalesce(p_q, ''), 120))), ' ')) as w
       where w <> ''
       limit 8
    ) as words
  ),
  matched as (
    select a.*, p.full_name, p.avatar_url,
           (a.visibility = 'public' or v.unlocked) as shows_name
      from agent_profiles a
      join profiles p on p.id = a.user_id
      cross join viewer v
      cross join needles n
     where v.may_browse
       and a.visibility <> 'hidden'
       and p.role = 'candidate'
       and p.approval_status = 'approved'
       and (p_tracks       is null or a.tracks && p_tracks)
       and (p_district_ids is null or a.district_ids && p_district_ids)
       and (p_availability is null or a.availability = p_availability)
       and (p_min_years    is null or a.years_experience >= p_min_years)
       -- The keyword matches only what this card shows this viewer: the
       -- headline always, the name only where the card carries it.
       and (
         cardinality(n.words) = 0
         or not exists (
           select 1
             from unnest(n.words) as w
            where strpos(
                    concat_ws(' ',
                      a.search_headline,
                      case when a.visibility = 'public' or v.unlocked then p.search_name end),
                    w) = 0
         )
       )
  )
  select
    m.id,
    case when m.shows_name then m.slug else m.id::text end as slug,
    m.shows_name                                  as is_unlocked,
    case when m.shows_name then m.full_name  end  as full_name,
    case when m.shows_name then m.avatar_url end  as avatar_url,
    m.headline_ar,
    m.headline_en,
    m.years_experience,
    m.tracks,
    m.district_ids,
    m.languages,
    m.availability,
    count(*) over ()                              as total_count
  from matched m
  order by m.years_experience desc, m.created_at desc, m.id
  limit greatest(1, least(p_limit, 60)) offset greatest(0, least(p_offset, 5000));
$$;

revoke execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int, text)
  from public, anon;
grant  execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A view is recorded by somebody the directory answers, of a card it shows.
-- Migration 304's body, with the gate. A pending or suspended employer still
-- resolves a company, and without this could stamp "a company looked at your
-- profile" on any consultant through the API.
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
  if not public.can_browse_agent_directory() then return; end if;

  select a.id, a.user_id into v_agent, v_owner
    from agent_profiles a
   where a.visibility <> 'hidden'
     and (
       a.slug = p_slug
       -- The cast lives inside a case so an unknown slug that is not a uuid
       -- never reaches it: `and` does not promise to short-circuit, and the
       -- page calls this in after(), where an error is nobody's to see.
       or a.id = case
         when p_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then p_slug::uuid
       end
     );

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

-- =============================================================================
-- Four more doors on the same corridor, found while closing the first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A photo is the account's own photo.
--
-- profiles.avatar_url was a free text column an account could write anything
-- into — profiles_update_self does not name columns and guard_profile_update
-- never looked at this one. The value is rendered as an <img> to every
-- employer who opens the applicant card and to every directory reader. Two
-- shapes are the whole of what the product writes: a file in the account's
-- own folder of the avatars bucket (uploadImage writes it there, re-encoded),
-- and the picture Google handed over at sign-up. Nothing else is a photo of
-- this person. The host of the storage URL is pinned where it is known —
-- trustedAvatarUrl in the app — since the schema cannot know it.
--
-- A trigger rather than a CHECK, so that an admin or the service role can
-- still repair a row.
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
     or new.avatar_url ~ '^https://[a-z0-9.-]*googleusercontent\.com/[A-Za-z0-9._~%/=-]+$'
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
-- true of `<uid>/../<somebody else>/cv.pdf`. Storage resolves the path as a
-- URL, and a URL collapses `..` — so the row passes every check while naming
-- another person's file, and the signed URL the route mints for it is minted
-- with the service role. The app says the same thing (isOwnedPath); the row
-- says it too, so the weaker statement is never the one relied on.
--
-- Exactly `<owner id>/<one file name>`: no second slash, and the name starts
-- with a letter or digit so `.` and `..` are not names. Every path the
-- product has ever written is `<uid>/<uuid>.<ext>`, which passes.
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
-- policies. A trigger, because the rule has to hold for the service role and
-- for an admin alike — the same shape as enforce_agent_is_candidate().
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
drop policy if exists saved_jobs_owner_select on saved_jobs;
drop policy if exists saved_jobs_owner_delete on saved_jobs;
drop policy if exists saved_jobs_owner_insert on saved_jobs;

create policy saved_jobs_owner_select on saved_jobs
  for select using (candidate_id = (select auth.uid()));

create policy saved_jobs_owner_delete on saved_jobs
  for delete using (candidate_id = (select auth.uid()));

create policy saved_jobs_owner_insert on saved_jobs
  for insert with check (
    candidate_id = (select auth.uid())
    and (select public.current_role_of_user()) = 'candidate'
  );

-- ---------------------------------------------------------------------------
-- A listing is edited by an employer in good standing.
--
-- owns_company() keeps a suspended account out since migration 308; this adds
-- the approved-employer test owns_job() makes, so an account still awaiting
-- approval cannot rewrite adverts either. The read stays — the console has
-- to be able to say what happened to their listings.
-- ---------------------------------------------------------------------------

drop policy if exists jobs_update_owner on jobs;
create policy jobs_update_owner on jobs
  for update using (public.owns_company(company_id) and (select public.is_approved_employer()))
  with check (public.owns_company(company_id) and (select public.is_approved_employer()));
