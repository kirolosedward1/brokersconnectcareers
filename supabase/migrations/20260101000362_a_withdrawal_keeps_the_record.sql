-- =============================================================================
-- 362 — A withdrawal keeps the record
--
-- Withdrawing deleted the application (migration 42: the candidate, and only
-- while it was new or shortlisted). The inbox then had a hole: a shortlisted
-- person simply vanished (migration 52), their notices stayed (351) or went
-- (the candidate's), and the row — the events, the fact that they applied —
-- was gone. The row stays now. status becomes withdrawn, withdrawn_at says
-- when, and the CV comes off the row so the file can be released.
--
-- Re-applying inserts a new row. The old unique (job_id, candidate_id) made
-- that impossible while the withdrawn row existed. A partial unique index
-- keeps one standing application per person per listing and allows any number
-- of withdrawn ones, so the earlier timeline is not rewritten into the new
-- application. Reviving the same row would have folded two applications into
-- one history.
--
-- 052, as it stands after 338: on_application_withdrawn tells the company
-- only when the application was shortlisted (a withdrawal from new is noise),
-- names the listing and not a new fact about the person, skips a retention
-- purge, and dedupes on the listing and the candidate. That notice moves to
-- the update. forget_application_notices (351) still runs on a real delete
-- (retention, a cascade) and now also when a row becomes withdrawn.
--
-- Compatibility: the new server calls withdraw_application and, until that
-- function exists, deletes the row as before. This file removes that delete,
-- so it ships in the same release as the server that calls the function. A
-- server that only deletes, left running after this file, would have its
-- withdrawal refused. Rolling the code back needs the delete policy put back.
-- =============================================================================

-- rollback: forward-fix only — restoring the delete would drop the withdrawn rows' history; to undo the behaviour, restate the functions from 62, 63, 46, 14, 328, 346, 349, 355, 347, 313, 43, 345, 344, 338, 351 and 204, drop withdraw_application, and recreate applications_withdraw_candidate from 42
-- safety: ships-with-code — until withdraw_application exists the new server deletes the row, as the old one does (a missing function is PGRST202). This file drops that delete, so it ships in the same release as the server that calls the function; the old server left running against it would have its withdrawal refused rather than delete
-- safety: constraint — withdrawn_at is null on every existing row and no row is withdrawn, so the check holds; the partial unique index matches the old (job_id, candidate_id) uniqueness for every standing row (production has no withdrawn rows) and only lets a second row exist once one of them is withdrawn
-- safety: rls — applications_withdraw_candidate (the candidate delete) is removed and not replaced by an update policy; the candidate withdraws only through withdraw_application, which refuses anyone else and any status past shortlisted. Employers already update through applications_update_employer; the guard now refuses a withdrawn row and a status of withdrawn from them
-- safety: definer — withdraw_application runs as its owner so it can update a row the candidate has no update policy for, and it sets a transaction-local flag the guard requires; search_path is pinned

-- ---------------------------------------------------------------------------
-- The row, kept
-- ---------------------------------------------------------------------------

alter table public.applications
  add column withdrawn_at timestamptz;

comment on column public.applications.withdrawn_at is
  'Set when the candidate withdraws. Null on every standing application. The status and this column move together (applications_withdrawn_at_matches_status).';

alter table public.applications
  drop constraint if exists applications_withdrawn_at_matches_status;

alter table public.applications
  add constraint applications_withdrawn_at_matches_status
  check ((status = 'withdrawn') = (withdrawn_at is not null));

-- One standing application per person per listing. Withdrawn rows stay, and
-- a later application is a new row rather than a revival of this one.
alter table public.applications drop constraint if exists applications_job_id_candidate_id_key;

create unique index applications_one_standing_per_job
  on public.applications (job_id, candidate_id)
  where status <> 'withdrawn';

-- ---------------------------------------------------------------------------
-- Who may withdraw, and nobody else may touch it afterwards
-- ---------------------------------------------------------------------------

drop policy if exists applications_withdraw_candidate on applications;

create or replace function public.withdraw_application(p_id uuid)
returns table (application_id uuid, previous_cv_path text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.applications%rowtype;
begin
  -- The candidate, and only them. An empty result is a refusal: not theirs,
  -- or the outcome is no longer open. Not an error, so a probe learns nothing
  -- but that no row changed.
  if auth.uid() is null or not public.is_candidate() then
    return;
  end if;

  select * into v
    from public.applications
   where id = p_id
   for update;

  if not found
     or v.candidate_id is distinct from auth.uid()
     or v.status not in ('new', 'shortlisted')
  then
    return;
  end if;

  -- The guard below allows this shape only while the flag is set, and a
  -- request cannot set it: it is transaction-local and this function is the
  -- only place that turns it on.
  perform set_config('app.withdrawing', 'on', true);

  update public.applications
     set status = 'withdrawn',
         withdrawn_at = now(),
         cv_path = null
   where id = p_id;

  application_id := v.id;
  previous_cv_path := v.cv_path;
  return next;
end;
$$;

revoke all on function public.withdraw_application(uuid) from public, anon;
grant execute on function public.withdraw_application(uuid) to authenticated;

create or replace function public.guard_application_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if coalesce(current_setting('app.withdrawing', true), '') = 'on' then
    if new.status = 'withdrawn'
       and old.status in ('new', 'shortlisted')
       and new.withdrawn_at is not null
       and new.cv_path is null
       and new.job_id is not distinct from old.job_id
       and new.candidate_id is not distinct from old.candidate_id
       and new.note is not distinct from old.note
       and new.created_at is not distinct from old.created_at
       and new.experience_band is not distinct from old.experience_band
       and new.decision_note is not distinct from old.decision_note
       and new.employer_viewed_at is not distinct from old.employer_viewed_at
    then
      return new;
    end if;
    raise exception 'a withdrawal changes only the status' using errcode = '42501';
  end if;

  -- Closed. The employer does not move it, reopen it, or rewrite it.
  if old.status = 'withdrawn' or new.status = 'withdrawn'
     or new.withdrawn_at is distinct from old.withdrawn_at
  then
    raise exception 'a withdrawn application is closed' using errcode = '42501';
  end if;

  -- The experience band is what the applicant declared, the same as their
  -- note and their CV: the employer moves the status and writes the decision.
  if (new.job_id, new.candidate_id, new.cv_path, new.note, new.created_at, new.experience_band)
     is distinct from
     (old.job_id, old.candidate_id, old.cv_path, old.note, old.created_at, old.experience_band)
  then
    raise exception 'only the application status and decision note may be changed';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The notices that used to run after the delete
-- ---------------------------------------------------------------------------

-- 338's function, on the update. A withdrawal from new is still not news.
-- A retention delete is not a withdrawal and this trigger is not on delete.
create or replace function public.on_application_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.retention_purge', true), 'off') = 'on' then
      return old;
    end if;
    if old.status is distinct from 'shortlisted' then
      return old;
    end if;
  elsif new.status is distinct from 'withdrawn' or old.status is distinct from 'shortlisted' then
    return new;
  end if;

  begin
    select j.id, j.title_ar, j.title_en, j.company_id
      into v_job
      from jobs j
     where j.id = old.job_id;

    if v_job.id is null then
      return coalesce(new, old);
    end if;

    perform public.notify_company(
      v_job.company_id,
      'application_withdrawn',
      jsonb_build_object(
        'job_id',   v_job.id,
        'title_ar', v_job.title_ar,
        'title_en', v_job.title_en
      ),
      '/employer/jobs/' || v_job.id || '/applicants',
      'application_withdrawn:' || v_job.id || ':' || old.candidate_id
    );
  exception when others then
    raise warning 'notification for withdrawal of % failed: % (%)', old.id, sqlerrm, sqlstate;
  end;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.on_application_withdrawn() from public, anon, authenticated;

drop trigger if exists applications_notify_withdrawal on applications;
create trigger applications_notify_withdrawal
  after update of status on applications
  for each row execute function public.on_application_withdrawn();

-- 351, and also when the row becomes withdrawn. A withdrawn sibling is not
-- "another application still standing": its notices go too.
create or replace function public.forget_application_notices()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate uuid := old.candidate_id;
  v_job uuid := old.job_id;
begin
  if tg_op = 'UPDATE'
     and (new.status is distinct from 'withdrawn' or old.status = 'withdrawn')
  then
    return new;
  end if;

  if exists (
    select 1 from applications a
     where a.candidate_id = v_candidate
       and a.job_id = v_job
       and a.id <> old.id
       and a.status <> 'withdrawn'
  ) then
    return case when tg_op = 'DELETE' then null else new end;
  end if;

  delete from notifications n
   where n.user_id = v_candidate
     and (
       (n.kind = 'application_submitted' and n.payload->>'job_id' = v_job::text)
       or (n.kind = 'application_moved'
           and n.payload->>'slug' = (select j.slug from jobs j where j.id = v_job))
     );

  return case when tg_op = 'DELETE' then null else new end;
end;
$$;

revoke execute on function public.forget_application_notices() from public, anon, authenticated;

drop trigger if exists applications_90_forget_notices on applications;
create trigger applications_90_forget_notices
  after delete on applications
  for each row execute function public.forget_application_notices();

drop trigger if exists applications_91_forget_notices_on_withdrawal on applications;
create trigger applications_91_forget_notices_on_withdrawal
  after update of status on applications
  for each row execute function public.forget_application_notices();

-- A withdrawal is not a stage the candidate is told as a move. The receipt
-- they get is APPLICATION_WITHDRAWN, from the action.
create or replace function public.on_application_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job       record;
  v_before    bigint;
  v_last_told application_status;
  v_told      bigint;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'withdrawn' then
    return new;
  end if;

  if new.status = 'new' then
    return new;
  end if;

  begin
    select max(e.id) into v_before
      from application_events e
     where e.application_id = new.id and e.to_status = old.status;

    select e.to_status into v_last_told
      from application_events e
     where e.application_id = new.id and e.to_status <> 'new' and e.id <= v_before
     order by e.id desc
     limit 1;

    if v_last_told is not distinct from new.status then
      return new;
    end if;

    select count(*) into v_told
      from (
        select e.to_status, lag(e.to_status) over (order by e.id) as before
          from application_events e
         where e.application_id = new.id and e.to_status <> 'new' and e.id <= v_before
      ) told
     where told.to_status = new.status and told.before is distinct from told.to_status;

    select j.title_ar, j.title_en, j.slug into v_job from jobs j where j.id = new.job_id;

    perform public.notify(
      new.candidate_id,
      'application_moved',
      jsonb_build_object(
        'status',   new.status::text,
        'title_ar', v_job.title_ar,
        'title_en', v_job.title_en,
        'slug',     v_job.slug,
        'note',     new.decision_note
      ),
      '/dashboard/applications',
      'application_moved:' || new.id || ':' || new.status::text
        || case when v_told > 0 then ':' || (v_told + 1)::text else '' end
    );
  exception when others then
    raise warning 'notification for application % move failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A withdrawn application is not consent to keep showing the profile
-- ---------------------------------------------------------------------------

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
       and a.status <> 'withdrawn'
       and public.owns_job(a.job_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- A withdrawn file is not in use
-- ---------------------------------------------------------------------------

create or replace function public.cv_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and split_part(coalesce(p_name, ''), '/', 1) = auth.uid()::text
     and (exists (select 1 from applications where cv_path = p_name and status <> 'withdrawn')
          or exists (select 1 from agent_profiles where cv_path = p_name));
$$;

revoke execute on function public.cv_in_use(text) from public, anon;
grant  execute on function public.cv_in_use(text) to authenticated, service_role;

create or replace function public.storage_object_is_referenced(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_bucket
    when 'cvs' then
         exists (select 1 from applications where cv_path = p_path and status <> 'withdrawn')
      or exists (select 1 from agent_profiles where cv_path = p_path)
    when 'avatars' then
         exists (select 1 from profiles
                  where avatar_url is not null
                    and public.storage_path_from_url(avatar_url, 'avatars') = p_path)
    when 'company-logos' then
         exists (select 1 from companies
                  where logo_url is not null
                    and public.storage_path_from_url(logo_url, 'company-logos') = p_path)
    when 'company-documents' then
         exists (select 1 from company_documents where storage_path = p_path)
    else true
  end;
$$;

revoke execute on function public.storage_object_is_referenced(text, text) from public, anon, authenticated;
grant  execute on function public.storage_object_is_referenced(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Counts, digests, trends. The row is visible; it is not a number.
-- ---------------------------------------------------------------------------

create or replace function public.employer_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_result  jsonb;
begin
  v_company := public.my_company_id();
  if v_company is null then return jsonb_build_object('has_company', false); end if;

  select jsonb_build_object(
    'has_company', true,
    'live_jobs', count(*) filter (where j.status = 'active' and (j.expires_at is null or j.expires_at > now())),
    'pending_jobs', count(*) filter (where j.status = 'pending_review'),
    'draft_jobs', count(*) filter (where j.status = 'draft'),
    'expiring_soon', count(*) filter (where j.status = 'active' and j.expires_at is not null and j.expires_at between now() and now() + interval '7 days'),
    'ended_jobs', count(*) filter (
      where j.status in ('expired', 'closed')
         or (j.status = 'active' and j.expires_at is not null and j.expires_at <= now())
    ),
    'total_views', coalesce(sum(j.view_count), 0),
    'seats_advertised', coalesce(sum(j.seats) filter (where j.status = 'active' and (j.expires_at is null or j.expires_at > now())), 0)
  ) into v_result
  from jobs j
  where j.company_id = v_company;

  return v_result || jsonb_build_object(
    'applicants_total',   (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.status <> 'withdrawn'),
    'applicants_new',     (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.status = 'new'),
    'applicants_unseen',  (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.employer_viewed_at is null and a.status <> 'withdrawn'),
    'applicants_7d',      (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.created_at > now() - interval '7 days' and a.status <> 'withdrawn'),
    'applicants_prev_7d', (select count(*) from applications a join jobs j on j.id = a.job_id where j.company_id = v_company and a.created_at between now() - interval '14 days' and now() - interval '7 days' and a.status <> 'withdrawn'),
    'credits',            (select post_credits from companies where id = v_company),
    'verification',       (select verification_status::text from companies where id = v_company)
  );
end;
$$;

create or replace function public.employer_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_today   date := (now() at time zone 'Africa/Cairo')::date;
  v_days    jsonb;
  v_conv    jsonb;
begin
  v_company := public.my_company_id();
  if v_company is null then return jsonb_build_object('has_company', false); end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('d', to_char(g.day, 'YYYY-MM-DD'), 'applications', coalesce(c.n, 0))
      order by g.day
    ),
    '[]'::jsonb
  ) into v_days
  from generate_series(v_today - 29, v_today, interval '1 day') as g(day)
  left join (
    select (a.created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
    from applications a
    join jobs j on j.id = a.job_id
    where j.company_id = v_company
      and a.status <> 'withdrawn'
      and a.created_at >= ((v_today - 29)::timestamp at time zone 'Africa/Cairo')
    group by 1
  ) c on c.day = g.day::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'title_ar', t.title_ar, 'title_en', t.title_en,
        'views', t.view_count, 'applications', t.applications
      )
      order by t.applications::numeric / nullif(t.view_count, 0) desc nulls last, t.applications desc
    ),
    '[]'::jsonb
  ) into v_conv
  from (
    select j.id, j.slug, j.title_ar, j.title_en, j.view_count,
           (select count(*) from applications a where a.job_id = j.id and a.status <> 'withdrawn')::int as applications
    from jobs j
    where j.company_id = v_company
      and j.status = 'active'
      and (j.expires_at is null or j.expires_at > now())
    order by j.published_at desc nulls last
    limit 6
  ) t;

  return jsonb_build_object('has_company', true, 'days', v_days, 'conversion', v_conv);
end;
$$;

create or replace function public.candidate_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'applications_total',    (select count(*) from applications where candidate_id = auth.uid() and status <> 'withdrawn'),
    'applications_new',      (select count(*) from applications where candidate_id = auth.uid() and status = 'new'),
    'applications_moved',    (select count(*) from applications where candidate_id = auth.uid() and status <> 'new' and status <> 'withdrawn'),
    'applications_hired',    (select count(*) from applications where candidate_id = auth.uid() and status = 'hired'),
    'replies',               (select count(*) from applications
                               where candidate_id = auth.uid()
                                 and status <> 'withdrawn'
                                 and (status <> 'new' or decision_note is not null)),
    'saved_jobs',            (select count(*) from saved_jobs where candidate_id = auth.uid()),
    'saved_searches',        (select count(*) from saved_searches where candidate_id = auth.uid()),
    'alerts_on',             (select count(*) from saved_searches where candidate_id = auth.uid() and alerts),
    'profile_completeness',  coalesce(
                               (select public.profile_completeness(a.id)
                                  from agent_profiles a where a.user_id = auth.uid()), 0),
    'has_profile',           exists (select 1 from agent_profiles where user_id = auth.uid()),
    'profile_views_30d',     coalesce((
                               select count(distinct v.company_id)
                                 from agent_profile_views v
                                 join agent_profiles a on a.id = v.agent_id
                                where a.user_id = auth.uid()
                                  and v.day >= ((now() at time zone 'Africa/Cairo')::date - 30)
                             ), 0),
    'open_jobs',             (select count(*) from jobs
                               where status = 'active'
                                 and (expires_at is null or expires_at > now()))
  );
$$;

create or replace function public.admin_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_days  jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'd',            to_char(g.day, 'YYYY-MM-DD'),
               'signups',      coalesce(s.n, 0),
               'published',    coalesce(p.n, 0),
               'applications', coalesce(a.n, 0)
             ) order by g.day
           ),
           '[]'::jsonb
         )
    into v_days
  from generate_series(v_today - 29, v_today, interval '1 day') as g(day)
  left join (
    select (created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from profiles group by 1
  ) s on s.day = g.day::date
  left join (
    select (published_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from jobs where published_at is not null group by 1
  ) p on p.day = g.day::date
  left join (
    select (created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from applications
     where status <> 'withdrawn'
     group by 1
  ) a on a.day = g.day::date;

  return jsonb_build_object('days', v_days);
end;
$$;

create or replace function public.admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'queue_total',      (select count(*) from jobs where status = 'pending_review'),
    'queue_over_24h',   (select count(*) from jobs
                          where status = 'pending_review' and created_at < now() - interval '24 hours'),
    'reports_open',     (select count(distinct (target_type, target_id))
                           from reports where status in ('open', 'investigating')),
    'appeals_open',     (select count(*) from moderation_appeals where status = 'open'),
    'companies_pending',(select count(*) from companies where verification_status = 'pending'),
    'accounts_pending', (select count(*) from profiles where approval_status = 'pending'),
    'companies_total',  (select count(*) from companies),
    'live_jobs',        (select count(*) from jobs
                          where status = 'active' and (expires_at is null or expires_at > now())),
    'candidates',       (select count(*) from profiles where role = 'candidate'),
    'employers',        (select count(*) from profiles where role = 'employer'),
    'signups_7d',       (select count(*) from profiles where created_at > now() - interval '7 days'),
    'published_7d',     (select count(*) from jobs where published_at > now() - interval '7 days'),
    'applications_7d',  (select count(*) from applications where created_at > now() - interval '7 days' and status <> 'withdrawn')
  );
end;
$$;

create or replace function public.pending_applicant_digests(p_since interval default '24 hours')
returns table (user_id uuid, applicant_count bigint, job_ids uuid[])
language sql
security definer
set search_path = public
as $$
  select p.id,
         count(a.id),
         array_agg(distinct a.job_id)
    from profiles p
    join company_members m on m.user_id = p.id
    join jobs      j on j.company_id = m.company_id
    join companies c on c.id = j.company_id
    join applications a on a.job_id = j.id
   where p.notify_applications = true
     and c.suspended_at is null
     and p.notify_applicant_digest = true
     and a.status <> 'withdrawn'
     and a.created_at > greatest(
           now() - interval '7 days',
           coalesce(
             (select coalesce(
                       (select max(r.started_at) from job_runs r
                         where r.job = 'daily-digest'
                           and r.status <> 'skipped'
                           and r.started_at <= last.sent_at
                           and r.started_at >  last.sent_at - interval '1 hour'),
                       last.sent_at)
                from (select max(e.sent_at) as sent_at from email_log e
                       where e.user_id = p.id and e.template = 'applicant_digest') last),
             now() - p_since
           )
         )
     and a.employer_viewed_at is null
   group by p.id
  having count(a.id) > 0;
$$;

create or replace function public.admin_user_activity(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with apps as (
    select a.status::text as s, count(*)::int as c
      from applications a
     where a.candidate_id = p_user
       and a.status <> 'withdrawn'
     group by a.status
  ),
  listings as (
    select j.status::text as s, count(*)::int as c
      from jobs j
     where j.company_id in (select m.company_id from company_members m where m.user_id = p_user)
     group by j.status
  ),
  filed as (
    select count(*)::int                                                      as total,
           count(*) filter (where r.status = 'dismissed')::int                as dismissed,
           count(*) filter (where r.abusive)::int                             as abusive,
           count(*) filter (where r.status in ('open', 'investigating'))::int as open
      from reports r
     where r.reporter_id = p_user
  ),
  appeals as (
    select count(*)::int                                     as total,
           count(*) filter (where ma.status = 'open')::int   as open
      from moderation_appeals ma
     where ma.appellant_id = p_user
  )
  select jsonb_build_object(
           'applications', jsonb_build_object(
             'total',     coalesce((select sum(c) from apps), 0),
             'by_status', coalesce((select jsonb_object_agg(s, c) from apps), '{}'::jsonb)),
           'listings', jsonb_build_object(
             'total',     coalesce((select sum(c) from listings), 0),
             'by_status', coalesce((select jsonb_object_agg(s, c) from listings), '{}'::jsonb)),
           'reports_filed', (select to_jsonb(f) from filed f),
           'appeals',       (select to_jsonb(ap) from appeals ap),
           'saved_jobs',    (select count(*) from saved_jobs sj where sj.candidate_id = p_user),
           'notes',         (select count(*) from moderation_notes n
                              where n.target_type = 'user' and n.target_id = p_user::text),
           'decisions',     (select count(*) from admin_audit_log l
                              where l.target_type = 'user' and l.target_id = p_user::text
                                and l.action <> 'user.contact_revealed')
         )
    into v;

  return v;
end;
$$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_jobs      jsonb;
  v_apps      jsonb;
  v_companies jsonb;
  v_accounts  jsonb;
  v_agents    jsonb;
  v_reports   jsonb;
  v_recent    jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'live',           count(*) filter (where status = 'active' and expires_at > now()),
    'pending',        count(*) filter (where status = 'pending_review'),
    'pending_24h',    count(*) filter (where status = 'pending_review' and created_at < now() - interval '24 hours'),
    'expired',        count(*) filter (where status = 'expired' or (status = 'active' and expires_at <= now())),
    'closed',         count(*) filter (where status = 'closed'),
    'rejected',       count(*) filter (where status = 'rejected'),
    'draft',          count(*) filter (where status = 'draft'),
    'expiring_7d',    count(*) filter (where status = 'active' and expires_at > now() and expires_at <= now() + interval '7 days'),
    'featured',       count(*) filter (where is_featured and status = 'active' and expires_at > now()),
    'live_no_applicants', count(*) filter (
       where status = 'active' and expires_at > now()
         and published_at < now() - interval '3 days'
         and not exists (
           select 1 from applications a
            where a.job_id = jobs.id and a.status <> 'withdrawn'))
  ) into v_jobs from jobs;

  select jsonb_build_object(
    'total',        count(*),
    'last_7d',      count(*) filter (where created_at > now() - interval '7 days'),
    'prev_7d',      count(*) filter (where created_at <= now() - interval '7 days' and created_at > now() - interval '14 days'),
    'unopened_7d',  count(*) filter (where status = 'new' and employer_viewed_at is null and created_at < now() - interval '7 days')
  ) into v_apps from applications
   where status <> 'withdrawn';

  select jsonb_build_object(
    'total',      count(*),
    'hiring',     count(*) filter (where exists (
                     select 1 from jobs j where j.company_id = companies.id
                        and j.status = 'active' and j.expires_at > now())),
    'pending',    count(*) filter (where verification_status = 'pending'),
    'verified',   count(*) filter (where verification_status = 'verified'),
    'suspended',  count(*) filter (where suspended_at is not null)
  ) into v_companies from companies;

  select jsonb_build_object(
    'candidates', count(*) filter (where role = 'candidate'),
    'employers',  count(*) filter (where role = 'employer'),
    'admins',     count(*) filter (where role = 'admin'),
    'pending',    count(*) filter (where approval_status = 'pending'),
    'suspended',  count(*) filter (where approval_status = 'rejected'),
    'signups_7d', count(*) filter (where created_at > now() - interval '7 days')
  ) into v_accounts from profiles;

  select jsonb_build_object(
    'total',      count(*),
    'public',     count(*) filter (where visibility = 'public'),
    'gated',      count(*) filter (where visibility = 'verified_employers_only'),
    'hidden',     count(*) filter (where visibility = 'hidden' and restricted_at is null),
    'restricted', count(*) filter (where restricted_at is not null)
  ) into v_agents from agent_profiles;

  select jsonb_build_object(
    'open_targets',  count(distinct (target_type, target_id)) filter (where status in ('open', 'investigating')),
    'open_jobs',     count(distinct job_id) filter (where status in ('open', 'investigating')),
    'open_companies',count(distinct company_id) filter (where status in ('open', 'investigating')),
    'open_agents',   count(distinct agent_id) filter (where status in ('open', 'investigating')),
    'investigating', count(*) filter (where status = 'investigating'),
    'last_7d',       count(*) filter (where created_at > now() - interval '7 days')
  ) into v_reports from reports;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_recent
    from (
      select id, actor_name, action, target_type, target_id, target_label, via, created_at
        from admin_audit_log
       order by created_at desc
       limit 8
    ) r;

  return jsonb_build_object(
    'jobs', v_jobs, 'applications', v_apps, 'companies', v_companies,
    'accounts', v_accounts, 'agents', v_agents, 'reports', v_reports,
    'recent', v_recent, 'generated_at', now());
end;
$$;

create or replace function public.security_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - interval '24 hours';
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'window_hours', 24,
    'events_by_kind', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'count', n) order by n desc, kind)
        from (select kind, count(*)::int as n from security_events
               where created_at > v_since group by kind) k
    ), '[]'::jsonb),
    'events_total',    (select count(*) from security_events where created_at > v_since),
    'events_warning',  (select count(*) from security_events where created_at > v_since and severity = 'warning'),
    'events_critical', (select count(*) from security_events where created_at > v_since and severity = 'critical'),
    'reveals_24h',     (select count(*) from agent_contact_reveals where created_at > v_since),
    'reveals_top_viewers', coalesce((
      select jsonb_agg(jsonb_build_object('viewer_id', viewer_id, 'count', n) order by n desc)
        from (select viewer_id, count(*)::int as n from agent_contact_reveals
               where created_at > v_since group by viewer_id order by n desc limit 5) v
    ), '[]'::jsonb),
    'rate_limited_24h', (select count(*) from security_events
                          where created_at > v_since and kind like '%rate_limited%'),
    'uploads_rejected_24h', (select count(*) from security_events
                              where created_at > v_since and kind like 'upload.%'),
    'auth_failures_24h', (select count(*) from security_events
                           where created_at > v_since and kind like 'auth.%'),
    'accounts_suspended', (select count(*) from profiles where approval_status = 'rejected'),
    'accounts_pending',   (select count(*) from profiles where approval_status = 'pending'),
    'reports_open',       (select count(distinct job_id) from reports where not resolved),
    'jobs_pending',       (select count(*) from jobs where status = 'pending_review'),
    'signups_24h',        (select count(*) from profiles where created_at > v_since),
    'applications_24h',   (select count(*) from applications where created_at > v_since and status <> 'withdrawn')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Support's count of applications is the standing ones. The recent list
-- still shows a withdrawal: that is what the person did.
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
      -- The total is standing applications. Recent still lists withdrawn ones: support is looking at what happened.
      'total', (select count(*) from applications a where a.candidate_id = v_user and a.status <> 'withdrawn'),
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

