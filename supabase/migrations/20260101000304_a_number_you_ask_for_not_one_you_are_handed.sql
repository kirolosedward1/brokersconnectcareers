-- =============================================================================
-- 304 — A number you ask for, not one you are handed
--
-- The consultant directory is the most valuable thing on this platform to the
-- wrong reader. Every card is a person with a phone number, and get_agent_card()
-- handed that number to anyone who called it: no session, no limit, and a
-- slug list one page of search_agents() away. A script could take the whole
-- directory home in a minute, and the profile page did the same with the CV,
-- minting a signed download link for whoever held the path.
--
-- Three changes, all below the interface.
--
-- The card no longer carries the contact. get_agent_card() returns what a card
-- shows — name, photo, headline, tracks, areas — and two booleans: whether a
-- CV exists and whether this viewer may ask for the contact. The phone number
-- and the CV path live only behind reveal_agent_contact(), which insists on a
-- signed-in employer in good standing with a company to act for (or the
-- owner, or an admin), applies the visibility gate, counts the reveal against
-- per-person and per-company limits, and writes down that it happened.
-- Re-opening the same profile within a day is one reveal, not two, so a
-- recruiter who comes back to a shortlist is not spending anything.
--
-- The limits are rows, not constants. abuse_limits holds every threshold the
-- database enforces from here on, with a note beside each saying what it is
-- for, so a limit that turns out to punish a real recruiter is a row update
-- and not a migration. Nothing in the interface prints them.
--
-- A locked card no longer says who it is. The slug is the consultant's name
-- transliterated, and search_agents() was returning it for every gated row
-- while withholding the name — which is the name, spelled differently. For a
-- card this viewer may not open, the handle is the row's id; the profile page
-- accepts either. Migration 60 already made this call for the shortlist.
--
-- The directory functions stay callable anonymously — /agents is a public
-- page, and migration 68 (search) settled that its readers need no session —
-- but what they return is now exactly what that page shows: no phone number,
-- no CV path, and for a locked card no slug. A signed-in reader keeps calling
-- them as themselves, which is what the visibility gate needs.
-- =============================================================================

-- rollback: forward-fix only for the two directory functions — get_agent_card() and search_agents() change shape here and the pages on this branch read the new shape; going back means restating the bodies from migrations 60 and 68. The rest can go: drop function if exists public.reveal_agent_contact, public.agent_card_open_to_viewer, public.limit_for; drop table if exists agent_contact_reveals, abuse_limits;
-- safety: grant, revoke-anon — get_agent_card() and search_agents() stay open to anon on
--   purpose: the directory and a card are public pages, and from this migration neither
--   returns a phone number, a CV path or a locked card's slug, so anon learns nothing
--   through PostgREST that the page does not already show.
-- safety: ships-with-code — the agent profile page is down for the minutes between the
--   two steps whichever lands first (old code asks for p_slug, new code for p_handle);
--   nothing is exposed in that window, because the old code never receives the phone
--   number and the new code never asks the old function. Deploy in one window.

-- ---------------------------------------------------------------------------
-- Thresholds, as data
-- ---------------------------------------------------------------------------

create table abuse_limits (
  key            text primary key,
  window_seconds int  not null check (window_seconds between 1 and 2592000),
  max_hits       int  not null check (max_hits >= 0),
  note           text,
  updated_at     timestamptz not null default now()
);

alter table abuse_limits enable row level security;

-- Admins may read and tune them. Nobody else reads them: a threshold that is
-- public is a threshold a script sits exactly beneath.
create policy abuse_limits_admin_all on abuse_limits
  for all using (public.is_admin()) with check (public.is_admin());

insert into abuse_limits (key, window_seconds, max_hits, note) values
  ('contact_reveal:user:hour',    3600,  30,  'Distinct consultant contacts one person may open in an hour. A busy recruiter opens a dozen.'),
  ('contact_reveal:user:day',     86400, 120, 'Distinct consultant contacts one person may open in a day.'),
  ('contact_reveal:company:day',  86400, 300, 'Distinct consultant contacts one company (all members) may open in a day.')
on conflict (key) do nothing;

/** The configured limit, or the default written into the calling function. */
create or replace function public.limit_for(p_key text, p_default_window int, p_default_max int)
returns table (window_seconds int, max_hits int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(l.window_seconds, p_default_window), coalesce(l.max_hits, p_default_max)
    from (select 1) as one
    left join abuse_limits l on l.key = p_key;
$$;

revoke execute on function public.limit_for(text, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The ledger of reveals
-- ---------------------------------------------------------------------------

create table agent_contact_reveals (
  id          bigserial primary key,
  agent_id    uuid not null references agent_profiles on delete cascade,
  viewer_id   uuid not null references profiles on delete cascade,
  company_id  uuid references companies on delete set null,
  created_at  timestamptz not null default now()
);

create index agent_contact_reveals_viewer_idx  on agent_contact_reveals (viewer_id, created_at desc);
create index agent_contact_reveals_company_idx on agent_contact_reveals (company_id, created_at desc)
  where company_id is not null;
create index agent_contact_reveals_agent_idx   on agent_contact_reveals (agent_id, created_at desc);

alter table agent_contact_reveals enable row level security;

-- Read by admins (the security page) and by the consultant it is about, who
-- is entitled to know how often their number has been asked for.
create policy agent_contact_reveals_admin_read on agent_contact_reveals
  for select using (public.is_admin());

create policy agent_contact_reveals_subject_read on agent_contact_reveals
  for select using (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Whether this viewer may open a card at all
-- ---------------------------------------------------------------------------

/**
 * A card is open to a viewer when the consultant said it is public, when the
 * viewer belongs to a verified company, when the consultant applied to one of
 * the viewer's listings, when it is the viewer's own, or when the viewer is an
 * admin. Hidden cards are open to their owner and to admins only. One place,
 * so the card, the reveal and the CV route cannot disagree.
 */
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
           a.visibility <> 'hidden'
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
-- The card, without the contact
-- ---------------------------------------------------------------------------

-- The return shape changes, and a function's OUT columns cannot be altered in
-- place.
drop function if exists public.get_agent_card(text);

create function public.get_agent_card(p_handle text)
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

-- A card without its contact details is a public page, so anon keeps it.
revoke execute on function public.get_agent_card(text) from public;
grant  execute on function public.get_agent_card(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The directory, with locked cards anonymous in every column
-- ---------------------------------------------------------------------------

-- Migration 68 (search) gave the directory a keyword, p_q, and dropped the
-- six-argument form. Both signatures go here so that a call which omits p_q
-- finds exactly one candidate, and the keyword search is kept as written
-- there: the headline is on every card, so everyone may search it; the name
-- is searchable only where it is shown. What this version adds is the rest of
-- the row: a locked card has no slug (the slug is the name, transliterated),
-- only approved accounts are listed, and the offset has a ceiling.
drop function if exists public.search_agents(job_track[], int[], agent_availability, int, int, int);
drop function if exists public.search_agents(job_track[], int[], agent_availability, int, int, int, text);

create function public.search_agents(
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
    select (public.viewer_has_verified_company() or public.is_admin()) as unlocked
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
     where a.visibility <> 'hidden'
       and p.role = 'candidate'
       and p.approval_status = 'approved'
       and (p_tracks       is null or a.tracks && p_tracks)
       and (p_district_ids is null or a.district_ids && p_district_ids)
       and (p_availability is null or a.availability = p_availability)
       and (p_min_years    is null or a.years_experience >= p_min_years)
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

-- The public API, as migration 68 left it: the directory is read by signed-out
-- visitors, and what it returns is what the page shows them.
revoke execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int, text)
  from public;
grant  execute on function public.search_agents(job_track[], int[], agent_availability, int, int, int, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The reveal
-- ---------------------------------------------------------------------------

/**
 * Hands over a consultant's contact, or says why not.
 *
 * Returns one row always, so the caller reads `status` rather than parsing an
 * exception: 'ok', 'unauthenticated', 'forbidden' (no company to act for, or
 * not an employer in good standing), 'locked' (the card is not open to this
 * viewer), 'not_found', or 'rate_limited' with the seconds until the window
 * turns over. A refusal that is recorded — the rate limit — is recorded before
 * it is answered, which a RAISE would roll back.
 */
create or replace function public.reveal_agent_contact(p_handle text)
returns table (
  status              text,
  retry_after_seconds int,
  full_name           text,
  whatsapp_phone      text,
  cv_path             text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_company   uuid;
  v_agent     agent_profiles%rowtype;
  v_person    profiles%rowtype;
  v_is_owner  boolean;
  v_is_admin  boolean;
  v_hour      record;
  v_day       record;
  v_cday      record;
  v_seen      boolean;
  v_hour_n    int;
  v_day_n     int;
  v_cday_n    int;
begin
  if v_uid is null then
    return query select 'unauthenticated', null::int, null::text, null::text, null::text;
    return;
  end if;

  select a.* into v_agent
    from agent_profiles a
   where a.slug = p_handle
      or (p_handle ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and a.id = p_handle::uuid);

  if v_agent.id is null then
    return query select 'not_found', null::int, null::text, null::text, null::text;
    return;
  end if;

  v_is_owner := v_agent.user_id = v_uid;
  v_is_admin := public.is_admin();
  v_company  := public.my_company_id();

  if not v_is_owner and not v_is_admin
     and (v_company is null or not public.is_approved_employer()) then
    return query select 'forbidden', null::int, null::text, null::text, null::text;
    return;
  end if;

  if not public.agent_card_open_to_viewer(v_agent.id) then
    return query select 'locked', null::int, null::text, null::text, null::text;
    return;
  end if;

  select p.* into v_person from profiles p where p.id = v_agent.user_id;

  -- The owner's own number and an admin's review are not what the limits are
  -- for, and neither is written to the ledger.
  if v_is_owner or v_is_admin then
    return query select 'ok', null::int, v_person.full_name, v_person.whatsapp_phone, v_agent.cv_path;
    return;
  end if;

  -- One reveal per viewer per consultant per day, however many times the page
  -- is opened. Counted before the lock so a repeat costs one index read.
  select exists (
    select 1 from agent_contact_reveals r
     where r.viewer_id = v_uid and r.agent_id = v_agent.id
       and r.created_at > now() - interval '1 day'
  ) into v_seen;

  if v_seen then
    return query select 'ok', null::int, v_person.full_name, v_person.whatsapp_phone, v_agent.cv_path;
    return;
  end if;

  -- Serialise this viewer's reveals, so twenty parallel requests cannot each
  -- see a count of nineteen.
  perform pg_advisory_xact_lock(hashtext('contact_reveal:' || v_uid::text));

  select * into v_hour from public.limit_for('contact_reveal:user:hour',   3600,  30);
  select * into v_day  from public.limit_for('contact_reveal:user:day',    86400, 120);
  select * into v_cday from public.limit_for('contact_reveal:company:day', 86400, 300);

  select count(*) into v_hour_n from agent_contact_reveals r
   where r.viewer_id = v_uid and r.created_at > now() - make_interval(secs => v_hour.window_seconds);
  select count(*) into v_day_n from agent_contact_reveals r
   where r.viewer_id = v_uid and r.created_at > now() - make_interval(secs => v_day.window_seconds);
  select count(*) into v_cday_n from agent_contact_reveals r
   where r.company_id = v_company and r.created_at > now() - make_interval(secs => v_cday.window_seconds);

  if v_hour_n >= v_hour.max_hits or v_day_n >= v_day.max_hits or v_cday_n >= v_cday.max_hits then
    perform public.record_security_event(
      'contact.reveal_rate_limited',
      case when v_day_n >= v_day.max_hits or v_cday_n >= v_cday.max_hits then 'warning' else 'info' end,
      null,
      jsonb_build_object('company_id', v_company, 'hour', v_hour_n, 'day', v_day_n, 'company_day', v_cday_n),
      v_uid
    );
    return query select
      'rate_limited',
      case when v_hour_n >= v_hour.max_hits then v_hour.window_seconds else v_day.window_seconds end,
      null::text, null::text, null::text;
    return;
  end if;

  insert into agent_contact_reveals (agent_id, viewer_id, company_id)
  values (v_agent.id, v_uid, v_company);

  return query select 'ok', null::int, v_person.full_name, v_person.whatsapp_phone, v_agent.cv_path;
end;
$$;

revoke execute on function public.reveal_agent_contact(text) from public, anon;
grant  execute on function public.reveal_agent_contact(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Views are recorded by handle too, and never for a hidden card
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
   where a.visibility <> 'hidden'
     and (
       a.slug = p_slug
       or (p_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           and a.id = p_slug::uuid)
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

-- ---------------------------------------------------------------------------
-- The view counter is the server's to call
-- ---------------------------------------------------------------------------

-- Anonymous callers could bump it without limit — and, as it happens, could
-- not bump it at all: guard_job_update refuses a view_count change from anyone
-- who is not acting as admin, so every call from a visitor's session raised
-- and the page discarded the error. The server now calls it with the service
-- role, which the guard waves through, and nobody else calls it.
revoke execute on function public.increment_job_view(text) from public, anon, authenticated;
grant  execute on function public.increment_job_view(text) to service_role;
