-- =============================================================================
-- 305 — What an employer may read about an applicant
--
-- profiles_select_applicants lets a company read the profile of anyone who
-- applied to one of its listings, which is the point: the name and the
-- WhatsApp number are how an interview gets arranged. It hands over the whole
-- row, and two of the columns on that row were never meant for anybody but the
-- platform.
--
-- unsubscribe_token is a credential. It is the one thing an email needs to
-- turn a person's notifications off without a session, and a company holding
-- an applicant's token can silence the messages that tell that applicant an
-- employer has replied — theirs or anyone else's.
--
-- approval_note is a reviewer's remark about the account — "documents did not
-- match", "suspended after reports" — written for other reviewers.
--
-- Both move to profile_private, one row per profile, with no policy that lets
-- anybody but an admin read it and none at all that lets anybody write it. The
-- email code reads it with the service role, which it already used; the
-- unsubscribe endpoint looks the token up there; the approval function writes
-- its note there. The two columns then leave profiles, so no SELECT on that
-- table — however wide — can carry them again.
--
-- Everything that touched the old columns is restated before they are
-- dropped: a trigger body that names a column the table no longer has fails
-- at the next update, which would have been every profile save on the site.
-- =============================================================================

-- rollback: forward-fix only — the values live in profile_private after this, so going back is: alter table profiles add column unsubscribe_token uuid, add column approval_note text; update profiles p set unsubscribe_token = pp.unsubscribe_token, approval_note = pp.approval_note from profile_private pp where pp.user_id = p.id; then restate set_account_approval(), on_approval_changed() and admin_support_facts() from their previous migrations.
-- safety: drop — both columns are copied row for row into profile_private above before
--   they go, in the same transaction, so no value is lost; what is lost is their
--   readability through profiles by anybody the profile row is visible to, which is
--   the point of the migration.
-- safety: ships-with-code — between the two steps, in either order, notification email
--   sending, the unsubscribe link and the admin's view of the approval note fail closed
--   for a few minutes; nothing is exposed and nothing is lost. Deploy in one window,
--   migration first.

create table profile_private (
  user_id            uuid primary key references profiles on delete cascade,
  unsubscribe_token  uuid not null default gen_random_uuid(),
  approval_note      text check (length(approval_note) <= 500),
  updated_at         timestamptz not null default now()
);

create unique index profile_private_token_idx on profile_private (unsubscribe_token);

alter table profile_private enable row level security;

-- Reviewers read the note beside the account it is about. Nobody writes
-- through the API: the token is minted by the row's default and the note by
-- set_account_approval().
create policy profile_private_admin_read on profile_private
  for select using (public.is_admin());

-- Carry the existing values across before anything reads from here.
insert into profile_private (user_id, unsubscribe_token, approval_note)
select id, unsubscribe_token, approval_note from profiles
on conflict (user_id) do nothing;

-- Every profile has its private row from the moment it exists.
create or replace function public.ensure_profile_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into profile_private (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.ensure_profile_private() from public, anon, authenticated;

create trigger profiles_05_private_row
  after insert on profiles
  for each row execute function public.ensure_profile_private();

-- ---------------------------------------------------------------------------
-- The approval lever writes its note beside the account, not on it
-- ---------------------------------------------------------------------------

create or replace function public.set_account_approval(
  p_user   uuid,
  p_status approval_status,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_user = auth.uid() then
    raise exception 'an admin cannot change their own approval';
  end if;

  if not exists (select 1 from profiles where id = p_user and role <> 'admin') then
    raise exception 'no such account, or it belongs to an admin';
  end if;

  -- The note first: the notification trigger on profiles reads it, and an
  -- AFTER trigger fires before the statement after the UPDATE runs.
  insert into profile_private (user_id, approval_note, updated_at)
  values (p_user, left(p_note, 500), now())
  on conflict (user_id) do update
    set approval_note = excluded.approval_note,
        updated_at    = now();

  update profiles
     set approval_status = p_status,
         approved_at     = case when p_status = 'approved' then now() else null end
   where id = p_user
     and role <> 'admin';

  if p_status = 'rejected' then
    update jobs
       set status = 'rejected',
           rejection_note = coalesce(p_note, 'الحساب موقوف')
     where status in ('active', 'pending_review')
       and company_id in (
         select cm.company_id
           from company_members cm
          where cm.user_id = p_user
            and not exists (
              select 1
                from company_members peer
                join profiles p on p.id = peer.user_id
               where peer.company_id = cm.company_id
                 and peer.user_id <> p_user
                 and p.approval_status = 'approved'
            )
       );
  end if;
end;
$$;

-- The notification that follows a decision reads the note from its new home.
create or replace function public.on_approval_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text;
begin
  if new.approval_status is not distinct from old.approval_status then
    return new;
  end if;

  if new.approval_status = 'approved' then
    perform public.notify(new.id, 'account_approved', '{}'::jsonb,
                          case when new.role = 'employer' then '/employer' else '/dashboard' end);
  elsif new.approval_status = 'rejected' then
    select approval_note into v_note from profile_private where user_id = new.id;
    perform public.notify(new.id, 'account_rejected',
                          jsonb_build_object('note', v_note), null);
  end if;

  return new;
end;
$$;

-- The guard, minus the two columns it will no longer see. Migration 47's rule
-- that an admin may not change their own approval stays.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    if new.id = (select auth.uid())
       and (new.role, new.approval_status, new.approved_at)
           is distinct from
           (old.role, old.approval_status, old.approved_at)
    then
      raise exception 'an admin cannot change their own approval';
    end if;

    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role changes are an admin action';
  end if;

  if (new.approval_status, new.approved_at)
     is distinct from
     (old.approval_status, old.approved_at)
  then
    raise exception 'approval is an admin action';
  end if;

  -- The account's own clock is not the account's to set.
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not user-writable';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- And the columns go
-- ---------------------------------------------------------------------------

alter table profiles
  drop column if exists unsubscribe_token,
  drop column if exists approval_note;

-- ---------------------------------------------------------------------------
-- The support lookup reads the note from where it now lives
-- ---------------------------------------------------------------------------

-- admin_support_facts() (migration 201) read approval_note off the profile
-- row, and the column has just gone. A function body cannot be patched, so it
-- is restated in full with one change: the note comes from profile_private.
create or replace function public.admin_support_facts(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q        text := nullif(btrim(p_query), '');
  v_user     uuid;
  v_digits   text;
  v_matches  int;
  v_auth     record;
  v_profile  record;
  v_company  record;
  v_out      jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_q is null then
    return jsonb_build_object('found', false, 'reason', 'empty');
  end if;

  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_user := v_q::uuid;
  elsif position('@' in v_q) > 0 then
    select u.id into v_user from auth.users u where lower(u.email) = lower(v_q) limit 1;
  elsif v_q ~ '^[+0-9 ()-]+$' then
    -- Stored as +20…; somebody pastes 010…, 2010… or +20 10…
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    if v_digits ~ '^0' then
      v_digits := '20' || substr(v_digits, 2);
    end if;
    select count(*), min(p.id::text)::uuid into v_matches, v_user
      from profiles p where p.whatsapp_phone = '+' || v_digits;
    if v_matches > 1 then
      return jsonb_build_object('found', false, 'reason', 'ambiguous');
    end if;
  else
    return jsonb_build_object('found', false, 'reason', 'query');
  end if;

  if v_user is null then
    return jsonb_build_object('found', false, 'reason', 'none');
  end if;

  select u.id, u.email_confirmed_at, u.confirmation_sent_at, u.recovery_sent_at,
         u.last_sign_in_at, u.created_at, u.banned_until,
         coalesce(u.raw_app_meta_data -> 'providers',
                  case when u.raw_app_meta_data ? 'provider'
                       then jsonb_build_array(u.raw_app_meta_data -> 'provider') end,
                  '[]'::jsonb) as providers
    into v_auth
    from auth.users u
   where u.id = v_user;

  if not found then
    return jsonb_build_object('found', false, 'reason', 'none');
  end if;

  select p.role::text as role, p.full_name, p.approval_status::text as approval_status,
         pp.approval_note, p.approved_at, p.locale, p.created_at,
         p.whatsapp_phone is not null and p.whatsapp_phone <> '' as has_whatsapp
    into v_profile
    from profiles p
    left join profile_private pp on pp.user_id = p.id
   where p.id = v_user;

  -- The company this account acts for, the way my_company_id() decides it:
  -- admin membership first, then the oldest.
  select c.id, c.name_ar, c.name_en, c.slug, c.verification_status::text as verification_status,
         c.verified_at, c.created_at, m.role::text as member_role
    into v_company
    from company_members m
    join companies c on c.id = m.company_id
   where m.user_id = v_user
   order by (m.role = 'admin') desc, m.created_at
   limit 1;

  v_out := jsonb_build_object(
    'found',   true,
    'user_id', v_user,
    'auth', jsonb_build_object(
      'email_confirmed_at',   v_auth.email_confirmed_at,
      'confirmation_sent_at', v_auth.confirmation_sent_at,
      'recovery_sent_at',     v_auth.recovery_sent_at,
      'last_sign_in_at',      v_auth.last_sign_in_at,
      'created_at',           v_auth.created_at,
      'banned_until',         v_auth.banned_until,
      'providers',            v_auth.providers
    ),
    'profile', case when v_profile.role is null then null else jsonb_build_object(
      'role',            v_profile.role,
      'full_name',       v_profile.full_name,
      'approval_status', v_profile.approval_status,
      'approval_note',   v_profile.approval_note,
      'approved_at',     v_profile.approved_at,
      'locale',          v_profile.locale,
      'created_at',      v_profile.created_at,
      'has_whatsapp',    v_profile.has_whatsapp
    ) end,
    'company', case when v_company.id is null then null else jsonb_build_object(
      'id',                  v_company.id,
      'name_ar',             v_company.name_ar,
      'name_en',             v_company.name_en,
      'slug',                v_company.slug,
      'verification_status', v_company.verification_status,
      'verified_at',         v_company.verified_at,
      'member_role',         v_company.member_role,
      -- Which papers, in what state, and what the reviewer said. Never where
      -- the file is.
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'doc_type',    d.doc_type,
                 'status',      d.status::text,
                 'review_note', d.review_note,
                 'created_at',  d.created_at,
                 'reviewed_at', d.reviewed_at) order by d.created_at desc)
          from company_documents d
         where d.company_id = v_company.id), '[]'::jsonb),
      'jobs_by_status', coalesce((
        select jsonb_object_agg(s.status, s.n)
          from (select j.status::text as status, count(*) as n
                  from jobs j where j.company_id = v_company.id group by j.status) s), '{}'::jsonb),
      'recent_jobs', coalesce((
        select jsonb_agg(r order by r.created_at desc)
          from (select j.id, j.title_ar, j.slug, j.status::text as status, j.rejection_note,
                       j.created_at, j.published_at, j.expires_at
                  from jobs j
                 where j.company_id = v_company.id
                 order by j.created_at desc
                 limit 8) r), '[]'::jsonb)
    ) end,
    'agent', (
      select jsonb_build_object(
               'slug',         a.slug,
               'visibility',   a.visibility::text,
               'availability', a.availability::text,
               'has_cv',       a.cv_path is not null,
               'created_at',   a.created_at)
        from agent_profiles a
       where a.user_id = v_user
    ),
    'applications', jsonb_build_object(
      'total', (select count(*) from applications a where a.candidate_id = v_user),
      'recent', coalesce((
        select jsonb_agg(r order by r.created_at desc)
          from (select a.id, a.status::text as status, a.created_at, j.title_ar, j.slug
                  from applications a
                  join jobs j on j.id = a.job_id
                 where a.candidate_id = v_user
                 order by a.created_at desc
                 limit 8) r), '[]'::jsonb)
    ),
    'notifications', coalesce((
      select jsonb_agg(r order by r.created_at desc)
        from (select n.kind::text as kind, n.created_at, n.read_at is not null as read
                from notifications n
               where n.user_id = v_user
               order by n.created_at desc
               limit 8) r), '[]'::jsonb),
    -- What the outbox tried to send them. Errors are the provider's text with
    -- any address in it replaced, the way observe.ts treats the same text.
    'emails', coalesce((
      select jsonb_agg(r order by r.created_at desc)
        from (select e.template, e.status::text as status, e.attempts, e.created_at,
                     e.sent_at, e.delivered_at,
                     regexp_replace(left(e.error, 300), '[[:alnum:]._%+-]+@[[:alnum:].-]+', '<address>', 'g') as error
                from email_log e
               where e.user_id = v_user
               order by e.created_at desc
               limit 8) r), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(r order by r.occurred_at desc)
        from (select s.reference, s.source, s.area, s.event, s.code, s.route, s.client,
                     s.release, s.occurred_at
                from support_events s
               where s.user_id = v_user
               order by s.occurred_at desc
               limit 12) r), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(r order by r.created_at desc)
        from (select q.id, q.reference, q.topic, q.status, q.created_at
                from support_requests q
               where q.user_id = v_user
               order by q.created_at desc
               limit 8) r), '[]'::jsonb)
  );

  return v_out;
end;
$$;

revoke execute on function public.admin_support_facts(text) from public, anon;
grant  execute on function public.admin_support_facts(text) to authenticated, service_role;
