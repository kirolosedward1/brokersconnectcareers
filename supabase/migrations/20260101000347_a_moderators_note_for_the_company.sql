-- =============================================================================
-- 347 — A moderator's note, for the company
--
-- Why a moderator refused or took down a listing was a column of the listing,
-- jobs.rejection_note, and so went wherever the listing's row went: to every
-- account that may read the listing, not only to its company. It moves to
-- job_moderation, which the listing's company and the admins read, as 327
-- moved a company's suspension reason to company_moderation and 305 an
-- account's to profile_private. The column stays, held null by a check, so a
-- reader that still selects it gets nothing rather than an error.
--
-- Every function that wrote or read the note is restated with that one
-- change: the review lever (admin_moderate_job), the suspension levers
-- (set_account_approval, admin_set_company_suspension), the bell
-- (on_job_moderated), the appeal snapshot and the console's support facts.
-- Each still writes the note before the status, because the bell the status
-- change rings quotes it. Tested in supabase/tests/doors.test.mjs.
-- =============================================================================

-- rollback: alter table jobs drop constraint jobs_rejection_note_is_private; update jobs j set rejection_note = m.rejection_note from job_moderation m where m.job_id = j.id; restate on_job_moderated() from migration 301, admin_support_facts() from 305, set_account_approval() and admin_set_company_suspension() from 344, admin_moderate_job() and appeal_decision_snapshot() from 346; drop table job_moderation
-- safety: constraint — production holds no note (checked 2026-10-03: no listing carries one), and this file moves any note into job_moderation and empties the column before the check is added
-- safety: drop — jobs_40_bump_version is off only for the one statement that empties the column, inside this file's transaction, and on again before it ends; no other session ever sees it off
-- safety: ships-with-code — the new code reads job_moderation and, until this file is applied (the table missing), the column as before; the levers and the bell are database functions, so a note goes wherever the database they run in keeps it. Applied before the deploy, main's listing pages read the now-empty column and show no reason until the new code arrives, while the bell and the email still quote it; production holds no note today

create table if not exists job_moderation (
  job_id         uuid primary key references jobs (id) on delete cascade,
  rejection_note text check (length(rejection_note) <= 500),
  updated_at     timestamptz not null default now()
);

comment on table job_moderation is
  'Why a moderator refused or took down a listing (migration 347): read by the listing''s company and the admins, written by the review and suspension levers.';

alter table job_moderation enable row level security;

drop policy if exists job_moderation_read on job_moderation;
create policy job_moderation_read on job_moderation
  for select using (
    exists (select 1 from jobs j where j.id = job_moderation.job_id and public.owns_company(j.company_id))
    or (select public.is_admin())
  );

revoke all on job_moderation from anon;
revoke insert, update, delete, truncate on job_moderation from authenticated;

insert into job_moderation (job_id, rejection_note)
select id, rejection_note from jobs where rejection_note is not null
on conflict (job_id) do update set rejection_note = excluded.rejection_note, updated_at = now();

-- Emptying the column is the platform's own write, not an edit, so the
-- version trigger stays out of it: an open appeal, and an edit form, were read
-- at the listing's version (346), and a raised version would read as an edit.
alter table jobs disable trigger jobs_40_bump_version;
update jobs set rejection_note = null where rejection_note is not null;
alter table jobs enable trigger jobs_40_bump_version;

alter table jobs drop constraint if exists jobs_rejection_note_is_private;
alter table jobs add constraint jobs_rejection_note_is_private check (rejection_note is null);

comment on column jobs.rejection_note is
  'Always null since migration 347: a moderator''s note lives in job_moderation, which the listing''s company and the admins read.';

-- ---------------------------------------------------------------------------
-- admin_moderate_job
-- ---------------------------------------------------------------------------

create or replace function public.admin_moderate_job(
  p_job     uuid,
  p_action  text,
  p_reason  text default null,
  p_version int  default null
)
returns job_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job    jobs%rowtype;
  v_next   job_status;
  v_reason text;
begin
  perform public.admin_begin();

  select * into v_job from jobs where id = p_job for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- The listing the moderator read, or none: the page sends the version it
  -- showed, and an edit since then is refused rather than approved unseen.
  if p_version is not null and v_job.version <> p_version then
    raise exception 'stale_version'
      using hint = 'This listing changed after the page was opened. Reload it and read it again.';
  end if;

  v_reason := public.admin_reason(p_reason, p_action in ('reject', 'request_changes', 'unpublish', 'close'));

  if p_action = 'approve' and v_job.status = 'pending_review' then
    v_next := 'active';
  elsif p_action = 'restore' and v_job.status = 'rejected' then
    v_next := 'active';
  elsif p_action in ('reject', 'request_changes') and v_job.status = 'pending_review' then
    v_next := 'rejected';
  elsif p_action = 'unpublish' and v_job.status = 'active' then
    v_next := 'rejected';
  elsif p_action = 'close' and v_job.status in ('active', 'expired') then
    v_next := 'closed';
  elsif p_action not in ('approve', 'restore', 'reject', 'request_changes', 'unpublish', 'close') then
    raise exception 'invalid_action';
  else
    raise exception 'invalid_transition'
      using hint = format('A %s listing cannot be %s.', v_job.status, p_action);
  end if;

  -- The note before the status: the bell (on_job_moderated, after the
  -- update) quotes it. It is the company's to read (job_moderation), not
  -- every candidate's who applied.
  if v_next = 'rejected' then
    insert into job_moderation (job_id, rejection_note, updated_at)
    values (p_job, v_reason, now())
    on conflict (job_id) do update
      set rejection_note = excluded.rejection_note, updated_at = now();
  elsif v_next = 'active' then
    delete from job_moderation where job_id = p_job;
  end if;

  update jobs set status = v_next where id = p_job;

  perform public.admin_audit(
    'job.' || p_action, 'job', p_job::text, v_job.title_ar, v_reason,
    jsonb_build_object('from', v_job.status, 'to', v_next, 'company_id', v_job.company_id));

  return v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_account_approval
-- ---------------------------------------------------------------------------

create or replace function public.set_account_approval(p_user uuid, p_status approval_status, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile profiles%rowtype;
  v_note    text;
  v_down    int := 0;
  v_job     uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_user = auth.uid() then
    raise exception 'an admin cannot change their own approval';
  end if;

  perform set_config('app.admin_console', 'on', true);

  select * into v_profile from profiles where id = p_user and role <> 'admin' for update;
  if not found then
    raise exception 'no such account, or it belongs to an admin';
  end if;

  if v_profile.approval_status = p_status then
    raise exception 'no_change' using hint = format('The account is already %s.', p_status);
  end if;

  -- At most 500 characters, the same cap profile_private enforces, so a long
  -- note is refused as 'reason_too_long' rather than as a constraint name.
  v_note := public.admin_reason(p_note, p_status = 'rejected', 500);

  -- The note first: the notification trigger on profiles reads it, and it
  -- fires as part of the UPDATE below.
  insert into profile_private (user_id, approval_note, updated_at)
  values (p_user, v_note, now())
  on conflict (user_id) do update
    set approval_note = excluded.approval_note,
        updated_at    = now();

  update profiles
     set approval_status = p_status,
         approved_at     = case when p_status = 'approved' then now() else null end
   where id = p_user;

  if p_status = 'rejected' then
    /*
      The profile above is already suspended by the time this runs, so the
      "is anybody else still approved" test does not need to exclude the target
      by status — but it does exclude them by id, because a company whose only
      member has just been suspended must not count that member as cover for
      itself.

      Not the note, which is the reviewer's, kept in profile_private for the
      account and the console: each listing taken down says only that, to its
      company (job_moderation). The note before the status, for the bell
      on_job_moderated rings.
    */
    for v_job in
      select j.id
        from jobs j
       where j.status in ('active', 'pending_review')
         and j.company_id in (
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
         )
       order by j.id
         for update of j
    loop
      insert into job_moderation (job_id, rejection_note, updated_at)
      values (v_job, 'الحساب موقوف', now())
      on conflict (job_id) do update
        set rejection_note = excluded.rejection_note, updated_at = now();
      update jobs set status = 'rejected' where id = v_job;
      v_down := v_down + 1;
    end loop;
  end if;

  perform public.admin_audit(
    case
      when p_status = 'rejected' then 'user.suspended'
      when p_status = 'pending'  then 'user.held'
      when v_profile.approval_status = 'rejected' then 'user.restored'
      else 'user.approved'
    end,
    'user', p_user::text, v_profile.full_name, v_note,
    jsonb_build_object('from', v_profile.approval_status, 'to', p_status,
                       'role', v_profile.role, 'listings_taken_down', v_down));
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_set_company_suspension
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_company_suspension(p_company uuid, p_suspend boolean, p_reason text default null::text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company companies%rowtype;
  v_reason  text;
  v_down    int := 0;
  v_job     uuid;
begin
  perform public.admin_begin();

  select * into v_company from companies where id = p_company for update;
  if not found then
    raise exception 'not_found';
  end if;

  v_reason := public.admin_reason(p_reason, true);

  if p_suspend and v_company.suspended_at is not null then
    raise exception 'no_change' using hint = 'The company is already suspended.';
  end if;
  if not p_suspend and v_company.suspended_at is null then
    raise exception 'no_change' using hint = 'The company is not suspended.';
  end if;

  if p_suspend then
    insert into company_moderation (company_id, suspension_reason, updated_at)
    values (p_company, v_reason, now())
    on conflict (company_id) do update
      set suspension_reason = excluded.suspension_reason, updated_at = now();

    update companies
       set suspended_at = now(), suspension_reason = null
     where id = p_company;

    -- Each listing taken down says only that, to the company (job_moderation);
    -- the reason is in company_moderation. The note before the status, for
    -- the bell on_job_moderated rings.
    for v_job in
      select id from jobs
       where company_id = p_company and status in ('active', 'pending_review')
       order by id
         for update
    loop
      insert into job_moderation (job_id, rejection_note, updated_at)
      values (v_job, 'الشركة موقوفة', now())
      on conflict (job_id) do update
        set rejection_note = excluded.rejection_note, updated_at = now();
      update jobs set status = 'rejected' where id = v_job;
      v_down := v_down + 1;
    end loop;
  else
    update company_moderation
       set suspension_reason = null, updated_at = now()
     where company_id = p_company;

    update companies
       set suspended_at = null, suspension_reason = null
     where id = p_company;
  end if;

  perform public.admin_audit(
    case when p_suspend then 'company.suspended' else 'company.restored' end,
    'company', p_company::text, v_company.name_ar, v_reason,
    jsonb_build_object('listings_taken_down', v_down));

  return v_down;
end;
$$;

-- ---------------------------------------------------------------------------
-- on_job_moderated
-- ---------------------------------------------------------------------------

create or replace function public.on_job_moderated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind notification_kind;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('active', 'rejected') then
    return new;
  end if;

  begin
    v_kind := (case when new.status = 'active' then 'job_published' else 'job_rejected' end)::notification_kind;

    perform public.notify_company(
      new.company_id,
      v_kind,
      jsonb_build_object(
        'job_id',   new.id,
        'title_ar', new.title_ar,
        'title_en', new.title_en,
        'slug',     new.slug,
        'note',     (select m.rejection_note from job_moderation m where m.job_id = new.id)
      ),
      case when new.status = 'active'
           then '/jobs/' || new.slug
           else '/employer/jobs/' || new.id || '/edit'
      end,
      v_kind::text || ':' || new.id || ':' || new.version
    );
  exception when others then
    raise warning 'notification for listing % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- appeal_decision_snapshot
-- ---------------------------------------------------------------------------

create or replace function public.appeal_decision_snapshot(
  p_user         uuid,
  p_subject_type text,
  p_subject_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if p_user is null then
    return null;
  end if;

  if p_subject_type = 'job' then
    select jsonb_build_object('status', j.status,
                              'note', (select m.rejection_note from job_moderation m where m.job_id = j.id),
                              'label_ar', j.title_ar, 'label_en', j.title_en, 'company_id', j.company_id,
                              'version', j.version)
      into v_snapshot
      from jobs j
     where j.id = p_subject_id
       and j.status = 'rejected'
       and exists (select 1 from company_members m where m.company_id = j.company_id and m.user_id = p_user);

  elsif p_subject_type = 'company' then
    select jsonb_build_object('suspended_at', c.suspended_at, 'note', cm.suspension_reason,
                              'label_ar', c.name_ar, 'label_en', c.name_en)
      into v_snapshot
      from companies c
      left join company_moderation cm on cm.company_id = c.id
     where c.id = p_subject_id
       and c.suspended_at is not null
       and exists (select 1 from company_members m where m.company_id = c.id and m.user_id = p_user);

  elsif p_subject_type = 'account' then
    -- Suspended, or held by a moderator — not the first review every new
    -- employer waits for, which is also "pending" but was never a decision.
    select jsonb_build_object('status', p.approval_status, 'label_ar', p.full_name, 'label_en', p.full_name)
      into v_snapshot
      from profiles p
     where p.id = p_subject_id
       and p.id = p_user
       and (p.approval_status = 'rejected'
            or (p.approval_status = 'pending'
                and (select a.action from admin_audit_log a
                      where a.target_type = 'user' and a.target_id = p.id::text
                        and a.action in ('user.approved', 'user.held', 'user.suspended', 'user.restored')
                      order by a.created_at desc, a.id desc
                      limit 1) = 'user.held'));

  elsif p_subject_type = 'agent' then
    select jsonb_build_object('restricted_at', a.restricted_at, 'note', a.restriction_reason,
                              'label_ar', a.slug, 'label_en', a.slug)
      into v_snapshot
      from agent_profiles a
     where a.id = p_subject_id
       and a.user_id = p_user
       and a.restricted_at is not null;
  end if;

  return v_snapshot;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_support_facts
-- ---------------------------------------------------------------------------

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
          from (select j.id, j.title_ar, j.slug, j.status::text as status,
                       (select m.rejection_note from job_moderation m where m.job_id = j.id) as rejection_note,
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

