-- =============================================================================
-- 331 — A decision is told to those it is about
--
-- Three SECURITY DEFINER functions answered more people than the rules around
-- them allow. Found by an authorization audit of what the app can reach, and
-- each confirmed against production in a transaction that was rolled back
-- (2026-09-29).
--
-- my_appeal_state() is the appeal page's question: may I appeal this, and what
--   was the last answer. It returned the last decision and its moderator's note
--   for any company, listing, account or consultant id to anybody signed in.
--   moderation_appeals' own read policy lets only the appellant, the company
--   concerned and admins see those rows, and the function's comment says
--   "never another person's appeal", but the body never asked: a candidate
--   read another company's decision note through it while the table showed
--   them nothing. It now answers only those the subject concerns — the
--   account's holder, a member of the company (a suspended one included: the
--   answer to their own appeal is what they are waiting for), the consultant —
--   and admins. Anybody else is told there is nothing to appeal and no history.
--
-- agent_card_is_open() is the check behind saving a consultant to a company's
--   shortlist. It never asked can_browse_agent_directory(), the one gate
--   migration 322 put every directory reader behind: a pending employer, whom
--   the directory refuses, could save a consultant by id and read the name and
--   photo back through saved_agent_cards(), which unlocked every card for a
--   member of a verified company. Both now ask the gate, except for somebody
--   who applied to one of the company's own listings, whom the applicant panel
--   shows regardless; and both count approved candidates only, as
--   agent_card_open_to_viewer() does.
--
-- storage_folder_count() is the per-folder cap the storage policies use. It
--   counted any folder of any bucket for anybody signed in — how many CVs a
--   person had uploaded, how many papers a company had filed, or, given '%', a
--   whole bucket. It now counts the caller's own folder, a company they
--   administer, or anything for an admin, and answers 0 otherwise. The
--   policies only ever ask about those folders, so their caps are unchanged.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: restate my_appeal_state() from migration 328, agent_card_is_open() and saved_agent_cards() from migration 60, and storage_folder_count() from migration 309, with the grants each carries there.
-- safety: function — the four keep their signatures, return types and grants; each answers its entitled callers exactly as before and the others with nothing, which is the rule the surrounding policies already state
-- safety: ships-with-code — no code change needed in either order: the website and the app call these only for the viewer's own subjects, own company and own folders, which get the same answers as before

-- ---------------------------------------------------------------------------
-- The appeal page's question, for those the subject concerns
-- ---------------------------------------------------------------------------

create or replace function public.my_appeal_state(p_subject_type text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_open jsonb;
  v_last jsonb;
  v_count int;
begin
  if v_user is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- The same people moderation_appeals_read lets read the rows, by membership
  -- rather than standing: a suspended company's members are who appeal it.
  if not (
       public.is_admin()
    or (p_subject_type = 'account' and p_subject_id = v_user)
    or (p_subject_type = 'company' and exists (
          select 1 from company_members m
           where m.company_id = p_subject_id and m.user_id = v_user))
    or (p_subject_type = 'job' and exists (
          select 1 from jobs j
            join company_members m on m.company_id = j.company_id
           where j.id = p_subject_id and m.user_id = v_user))
    or (p_subject_type = 'agent' and exists (
          select 1 from agent_profiles a
           where a.id = p_subject_id and a.user_id = v_user))
  ) then
    return jsonb_build_object('appealable', false, 'open', null, 'last', null);
  end if;

  select jsonb_build_object('id', a.id, 'created_at', a.created_at)
    into v_open
    from moderation_appeals a
   where a.subject_type = p_subject_type and a.subject_id = p_subject_id and a.status = 'open';

  select jsonb_build_object('status', a.status, 'decided_at', a.decided_at, 'note', a.decision_note),
         count(*) over ()
    into v_last, v_count
    from moderation_appeals a
   where a.subject_type = p_subject_type and a.subject_id = p_subject_id and a.status <> 'open'
   order by a.decided_at desc
   limit 1;

  return jsonb_build_object(
    'appealable', public.appeal_decision_snapshot(v_user, p_subject_type, p_subject_id) is not null
                  and v_open is null
                  and coalesce(v_count, 0) < 3
                  and coalesce((v_last ->> 'decided_at')::timestamptz, '-infinity') <= now() - interval '7 days',
    'open', v_open,
    'last', v_last);
end;
$$;

revoke execute on function public.my_appeal_state(text, uuid) from public, anon;
grant  execute on function public.my_appeal_state(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Saving a consultant: behind the directory's own gate
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
       and p.approval_status = 'approved'
       and a.visibility <> 'hidden'
       and (
         public.is_admin()
         or public.applied_to_my_job(a.user_id)
         or (public.can_browse_agent_directory()
             and (a.visibility = 'public' or public.viewer_has_verified_company()))
       )
  );
$$;

revoke execute on function public.agent_card_is_open(uuid) from public, anon;
grant  execute on function public.agent_card_is_open(uuid) to authenticated, service_role;

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
    -- Null for anyone who is not in a company, which makes the join below
    -- match nothing. The function guards itself rather than trusting a caller
    -- to have checked.
    select public.my_company_id()               as company,
           public.is_admin()                    as admin,
           public.can_browse_agent_directory()  as browses,
           public.viewer_has_verified_company() as verified
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
      (a.visibility <> 'hidden' and p.role = 'candidate' and p.approval_status = 'approved') as listed,
      -- agent_card_is_open(), row by row: the directory's gate, or an applicant.
      (v.admin
       or public.applied_to_my_job(a.user_id)
       or (v.browses and (a.visibility = 'public' or v.verified)))                         as open
    from saved_agents s
    join agent_profiles a on a.id = s.agent_id
    join profiles p       on p.id = a.user_id
    cross join viewer v
    left join profiles sb on sb.id = s.saved_by
    where s.company_id = v.company
  )
  select
    c.agent_id                                                     as id,
    case when c.listed then c.slug             end                 as slug,
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
  -- The last key cannot tie, so the order is total and page two does not
  -- repeat a row from page one.
  order by c.created_at desc, c.agent_id
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

revoke execute on function public.saved_agent_cards(int, int) from public, anon;
grant  execute on function public.saved_agent_cards(int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A folder's count, to whoever the folder is
-- ---------------------------------------------------------------------------

create or replace function public.storage_folder_count(p_bucket text, p_folder text)
returns int
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_folder is null then
    return 0;
  end if;

  -- CASE, not AND, so the cast is only tried on something shaped like an id.
  if not (
       p_folder = v_uid::text
    or public.is_admin()
    or case when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then public.is_company_admin(p_folder::uuid)
            else false
       end
  ) then
    return 0;
  end if;

  return (
    select count(*)::int
      from storage.objects
     where bucket_id = p_bucket
       and name like p_folder || '/%'
  );
end;
$$;

revoke execute on function public.storage_folder_count(text, text) from public, anon;
grant  execute on function public.storage_folder_count(text, text) to authenticated, service_role;
