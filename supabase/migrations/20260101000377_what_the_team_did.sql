-- =============================================================================
-- 377 — What the team did
--
-- A company could not see who on its team moved an applicant, revealed a
-- number, sent a listing for review or added a colleague
-- (docs/design/v1.1/phase-b/04). The doc proposed reading it all from the
-- tables that already hold each part. Two things made that wrong:
--
--   * nothing records who submitted, closed or reopened a listing — audit_log
--     keeps only a moderator's decisions;
--   * a reveal is kept 90 days (migration 338), and a company keeps six
--     months of activity (decided).
--
-- So: one append-only table, company_activity, written by triggers on the
-- tables themselves, so no door around the website's actions skips it. A row
-- holds ids and a small detail (a status, a role, a pack) — never a name, a
-- note's words or a number. Names are read when the log is read, so a person
-- who deletes their account is not kept here by name.
--
-- Read only through company_activity_page(): the company's admins and its
-- owner see everyone's; any other member sees only their own (decided). Six
-- months, by the read and by a nightly purge where pg_cron exists.
--
-- Tested in supabase/tests/company-activity.test.mjs.
--
-- rollback: select cron.unschedule('brokersconnect-company-activity-purge') (where pg_cron exists);
--           drop trigger if exists application_events_80_activity on application_events;
--           drop trigger if exists application_notes_80_activity on application_notes;
--           drop trigger if exists company_candidate_notes_80_activity on company_candidate_notes;
--           drop trigger if exists interview_invites_80_activity on interview_invites;
--           drop trigger if exists agent_contact_reveals_80_activity on agent_contact_reveals;
--           drop trigger if exists jobs_80_activity on jobs;
--           drop trigger if exists company_members_80_activity on company_members;
--           drop trigger if exists orders_80_activity on orders;
--           drop function if exists public.company_activity_page(timestamptz, bigint, uuid, int),
--             public.purge_company_activity(), public.record_company_activity(uuid, text, uuid, uuid, uuid, uuid, jsonb),
--             public.activity_from_application_event(), public.activity_from_application_note(),
--             public.activity_from_candidate_note(), public.activity_from_interview(),
--             public.activity_from_reveal(), public.activity_from_job(), public.activity_from_member(),
--             public.activity_from_order(), public.acts_for_company(uuid);
--           drop table if exists company_activity;
-- safety: additive — the triggers only insert into a new table, and one
--         that cannot insert is caught, so the change it records still commits.
-- =============================================================================

create table if not exists company_activity (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references companies(id) on delete cascade,
  -- Null when nobody signed in did it (a payment confirmed by the provider),
  -- or when the account is later deleted: what happened still happened.
  actor_id        uuid references profiles(id) on delete set null,
  kind            text not null check (kind in (
                    'application_moved', 'note_added', 'interview_invited',
                    'contact_revealed', 'job_created', 'job_status',
                    'member_added', 'member_removed', 'member_changed', 'order_paid')),
  job_id          uuid references jobs(id) on delete set null,
  application_id  uuid references applications(id) on delete set null,
  -- A colleague added or removed, or the candidate a note is about.
  subject_user_id uuid references profiles(id) on delete set null,
  agent_id        uuid references agent_profiles(id) on delete set null,
  detail          jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 1024),
  created_at      timestamptz not null default now()
);

create index if not exists company_activity_company_idx on company_activity (company_id, created_at desc, id desc);
create index if not exists company_activity_actor_idx on company_activity (actor_id, created_at desc);
create index if not exists company_activity_job_idx on company_activity (job_id);
create index if not exists company_activity_application_idx on company_activity (application_id);
create index if not exists company_activity_subject_idx on company_activity (subject_user_id);
create index if not exists company_activity_agent_idx on company_activity (agent_id);

-- No policy: nobody reads or writes it directly, only through the functions below.
alter table company_activity enable row level security;
revoke all on company_activity from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------

create or replace function public.record_company_activity(
  p_company     uuid,
  p_kind        text,
  p_job         uuid default null,
  p_application uuid default null,
  p_subject     uuid default null,
  p_agent       uuid default null,
  p_detail      jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A company on its way out (a cascade from its own deletion) has no log to keep.
  if p_company is null or not exists (select 1 from companies where id = p_company) then
    return;
  end if;
  insert into company_activity (company_id, actor_id, kind, job_id, application_id, subject_user_id, agent_id, detail)
  values (
    p_company,
    -- Only a person who is still a profile; the service role has no uid.
    (select id from profiles where id = auth.uid()),
    p_kind, p_job, p_application, p_subject, p_agent, coalesce(p_detail, '{}'::jsonb)
  );
exception when others then
  -- The log must never cost the change it records.
  raise warning 'company_activity: % (%)', sqlerrm, p_kind;
end;
$$;

revoke execute on function public.record_company_activity(uuid, text, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Whether the caller acts for this company: the moves a candidate or a
-- moderator makes on its rows are theirs, not the team's.
create or replace function public.acts_for_company(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from company_members where company_id = p_company and user_id = auth.uid());
$$;

revoke execute on function public.acts_for_company(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The triggers
-- ---------------------------------------------------------------------------

create or replace function public.activity_from_application_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job uuid;
  v_company uuid;
begin
  -- The first event is the candidate applying.
  if new.from_status is null then
    return new;
  end if;
  select a.job_id, j.company_id into v_job, v_company
    from applications a join jobs j on j.id = a.job_id
   where a.id = new.application_id;
  if public.acts_for_company(v_company) then
    perform public.record_company_activity(v_company, 'application_moved', v_job, new.application_id, null, null,
      jsonb_build_object('from', new.from_status, 'to', new.to_status));
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_application_event() from public, anon, authenticated;

drop trigger if exists application_events_80_activity on application_events;
create trigger application_events_80_activity
  after insert on application_events
  for each row execute function public.activity_from_application_event();

create or replace function public.activity_from_application_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job uuid;
  v_company uuid;
begin
  select a.job_id, j.company_id into v_job, v_company
    from applications a join jobs j on j.id = a.job_id
   where a.id = new.application_id;
  if public.acts_for_company(v_company) then
    perform public.record_company_activity(v_company, 'note_added', v_job, new.application_id, null, null, '{}'::jsonb);
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_application_note() from public, anon, authenticated;

drop trigger if exists application_notes_80_activity on application_notes;
create trigger application_notes_80_activity
  after insert on application_notes
  for each row execute function public.activity_from_application_note();

create or replace function public.activity_from_candidate_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.acts_for_company(new.company_id) then
    perform public.record_company_activity(new.company_id, 'note_added', null, null, new.candidate_id, null, '{}'::jsonb);
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_candidate_note() from public, anon, authenticated;

drop trigger if exists company_candidate_notes_80_activity on company_candidate_notes;
create trigger company_candidate_notes_80_activity
  after insert on company_candidate_notes
  for each row execute function public.activity_from_candidate_note();

create or replace function public.activity_from_interview()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job uuid;
  v_company uuid;
begin
  select a.job_id, j.company_id into v_job, v_company
    from applications a join jobs j on j.id = a.job_id
   where a.id = new.application_id;
  if public.acts_for_company(v_company) then
    perform public.record_company_activity(v_company, 'interview_invited', v_job, new.application_id, null, null, '{}'::jsonb);
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_interview() from public, anon, authenticated;

drop trigger if exists interview_invites_80_activity on interview_invites;
create trigger interview_invites_80_activity
  after insert on interview_invites
  for each row execute function public.activity_from_interview();

create or replace function public.activity_from_reveal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The consultant is recorded, never the number.
  if new.company_id is not null then
    perform public.record_company_activity(new.company_id, 'contact_revealed', null, null, null, new.agent_id, '{}'::jsonb);
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_reveal() from public, anon, authenticated;

drop trigger if exists agent_contact_reveals_80_activity on agent_contact_reveals;
create trigger agent_contact_reveals_80_activity
  after insert on agent_contact_reveals
  for each row execute function public.activity_from_reveal();

create or replace function public.activity_from_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.acts_for_company(new.company_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_company_activity(new.company_id, 'job_created', new.id, null, null, null,
      jsonb_build_object('to', new.status));
  elsif new.status is distinct from old.status then
    perform public.record_company_activity(new.company_id, 'job_status', new.id, null, null, null,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_job() from public, anon, authenticated;

drop trigger if exists jobs_80_activity on jobs;
create trigger jobs_80_activity
  after insert or update of status on jobs
  for each row execute function public.activity_from_job();

create or replace function public.activity_from_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_company_activity(new.company_id, 'member_added', null, null, new.user_id, null,
      jsonb_build_object('role', new.role));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_company_activity(old.company_id, 'member_removed', null, null, old.user_id, null,
      jsonb_build_object('role', old.role));
    return old;
  elsif (new.role, new.can_post, new.can_reveal, new.can_spend)
        is distinct from (old.role, old.can_post, old.can_reveal, old.can_spend) then
    perform public.record_company_activity(new.company_id, 'member_changed', null, null, new.user_id, null,
      jsonb_build_object('role', new.role, 'can_post', new.can_post, 'can_reveal', new.can_reveal, 'can_spend', new.can_spend));
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_member() from public, anon, authenticated;

drop trigger if exists company_members_80_activity on company_members;
create trigger company_members_80_activity
  after insert or update or delete on company_members
  for each row execute function public.activity_from_member();

create or replace function public.activity_from_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.record_company_activity(new.company_id, 'order_paid', null, null, null, null,
      jsonb_build_object('pack', new.pack_key, 'credits', new.credits));
  end if;
  return new;
end;
$$;

revoke execute on function public.activity_from_order() from public, anon, authenticated;

drop trigger if exists orders_80_activity on orders;
create trigger orders_80_activity
  after update of status on orders
  for each row execute function public.activity_from_order();

-- ---------------------------------------------------------------------------
-- The reader
-- ---------------------------------------------------------------------------

-- Newest first, a page at a time, keyed on (created_at, id). An admin (the
-- owner is one) reads everyone's and may narrow it to one member; anybody
-- else on the team reads their own, whatever p_member says.
create or replace function public.company_activity_page(
  p_before    timestamptz default null,
  p_before_id bigint default null,
  p_member    uuid default null,
  p_limit     int default 50
)
returns table (
  id              bigint,
  at              timestamptz,
  actor_id        uuid,
  actor_name      text,
  kind            text,
  job_id          uuid,
  job_title_ar    text,
  job_title_en    text,
  application_id  uuid,
  candidate_name  text,
  subject_user_id uuid,
  subject_name    text,
  agent_id        uuid,
  agent_name      text,
  detail          jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.my_company_id();
  v_all boolean;
begin
  if v_company is null then
    return;
  end if;
  v_all := public.is_company_admin(v_company);
  return query
    select ca.id, ca.created_at, ca.actor_id, actor.full_name, ca.kind,
           ca.job_id, j.title_ar, j.title_en, ca.application_id, candidate.full_name,
           ca.subject_user_id, subject.full_name, ca.agent_id, agent_person.full_name, ca.detail
      from company_activity ca
      left join profiles actor on actor.id = ca.actor_id
      left join jobs j on j.id = ca.job_id and j.company_id = ca.company_id
      left join applications a on a.id = ca.application_id
      left join profiles candidate on candidate.id = a.candidate_id
      left join profiles subject on subject.id = ca.subject_user_id
      left join agent_profiles ap on ap.id = ca.agent_id
      left join profiles agent_person on agent_person.id = ap.user_id
     where ca.company_id = v_company
       and ca.created_at >= now() - interval '6 months'
       and (case when v_all then (p_member is null or ca.actor_id = p_member) else ca.actor_id = auth.uid() end)
       and (p_before is null or (ca.created_at, ca.id) < (p_before, coalesce(p_before_id, 9223372036854775807)))
     order by ca.created_at desc, ca.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

revoke execute on function public.company_activity_page(timestamptz, bigint, uuid, int) from public, anon;
grant execute on function public.company_activity_page(timestamptz, bigint, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Six months
-- ---------------------------------------------------------------------------

create or replace function public.purge_company_activity()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  delete from company_activity where created_at < now() - interval '6 months';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.purge_company_activity() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'brokersconnect-company-activity-purge',
      '47 3 * * *',
      'select public.purge_company_activity()'
    );
  end if;
end;
$$;
