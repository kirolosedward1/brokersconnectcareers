-- =============================================================================
-- 326 — Reports that cannot be turned into a weapon, and cannot be erased
--
-- Migration 317 gave reports three targets and a status. What it left:
--
--   A report vanished with the thing it was about. The target columns cascade,
--   so an admin deleting a reported listing — or a reported consultant deleting
--   their own account — deleted every complaint about it, and with them the
--   only record of what the advert said on the day somebody flagged it.
--
--   The only brake on reporting was ten a day. One person could still file
--   three reports inside a minute, a two-hour-old account could file ten, and
--   a competitor could spend a whole week's allowance on one rival company's
--   listings. The queue is read by a person, which is exactly what makes it
--   worth flooding — and a report is a request for somebody else's advert to
--   come down, which is exactly what makes it worth faking.
--
--   A moderator could say "no violation" but not "this was filed in bad
--   faith", so nothing distinguished a mistaken reporter from a malicious one.
--
--   Nothing told the reporter anything, ever.
--
-- What this adds, and what it deliberately does not:
--
--   Evidence. Every report records what it was about (target_type, target_id)
--   and a snapshot of it as it stood when reported. The target columns now
--   null out instead of cascading, so a deleted listing leaves its reports —
--   and its snapshot — behind. Once written, the evidence columns are fixed,
--   for admins too.
--
--   Severity, from the reason alone: 3 for an allegation of fraud or harm
--   (scam, impersonation, harassment, a fake job), 2 for misleading or
--   offensive content, 1 for quality. It ranks the queue; it never decides
--   anything. It says what the reporter *alleged*, which is the only thing
--   that can be known objectively before somebody looks.
--
--   Limits that only a pattern of abuse meets: three reports in ten minutes,
--   three a day from an account under a day old, three a week about any one
--   company's listings, none about your own. The daily ten stays where it is
--   (migration 19). Each refusal is its own word, so the dialog can say which.
--
--   A reporting ban, set and lifted by an admin with a reason, on the record.
--   And "dismissed, filed in bad faith" as an outcome of its own — which feeds
--   the reporter context the queue shows, and nothing automatic.
--
--   No report does anything by itself. There is no count of reports at which a
--   listing comes down; a person decides, every time.
-- =============================================================================

-- rollback: by hand, 328 then 327 then this — the statements are listed at the end of this file
-- safety: constraint — reports has no rows on production (checked 2026-09-27), so the not-nulls, checks, rebuilt foreign keys and unique index validate nothing; on a database with reports the backfill above satisfies them first
-- safety: ships-with-code — apply after the deploy that carries this branch's src/ changes. The new code works without it (the console says the migration is missing, the report and appeal forms refuse cleanly), but main's bell shows the notification kinds this writes (report_reviewed) only as its generic line, so the person would not be told what happened until the code arrives.

-- ---------------------------------------------------------------------------
-- One writer for the moderation bells
--
-- These triggers write the notifications table directly rather than through
-- notify(), because notify() is mid-redesign on two open branches (one drops
-- the four-argument form for a five-argument one, one restates it with
-- dedupe). Whichever wins, only this function needs to follow it.
-- ---------------------------------------------------------------------------

create or replace function public.moderation_notify(
  p_user    uuid,
  p_kind    notification_kind,
  p_payload jsonb,
  p_href    text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into notifications (user_id, kind, payload, href)
  select p_user, p_kind, coalesce(p_payload, '{}'::jsonb), p_href
   where p_user is not null;
$$;

revoke execute on function public.moderation_notify(uuid, notification_kind, jsonb, text)
  from public, anon, authenticated;

create or replace function public.moderation_notify_company(
  p_company uuid,
  p_kind    notification_kind,
  p_payload jsonb,
  p_href    text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into notifications (user_id, kind, payload, href)
  select m.user_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_href
    from company_members m
   where m.company_id = p_company;
$$;

revoke execute on function public.moderation_notify_company(uuid, notification_kind, jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Evidence: what was reported, as it stood
-- ---------------------------------------------------------------------------

alter table reports
  add column if not exists target_type     text,
  add column if not exists target_id       uuid,
  add column if not exists target_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists source          text not null default 'user',
  add column if not exists abusive         boolean not null default false;

update reports
   set target_type = case when job_id is not null then 'job'
                          when company_id is not null then 'company'
                          else 'agent' end,
       target_id   = coalesce(job_id, company_id, agent_id)
 where target_type is null;

alter table reports alter column target_type set not null;
alter table reports alter column target_id set not null;

alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check
  check (target_type in ('job', 'company', 'agent'));

-- The live link, while the target exists, must agree with the record of it.
alter table reports drop constraint if exists reports_target_agrees;
alter table reports add constraint reports_target_agrees check (
      (job_id is null or (target_type = 'job' and job_id = target_id))
  and (company_id is null or (target_type = 'company' and company_id = target_id))
  and (agent_id is null or (target_type = 'agent' and agent_id = target_id))
);

-- At most one live link: none once the target has been deleted.
alter table reports drop constraint if exists reports_one_target;
alter table reports add constraint reports_one_target
  check (num_nonnulls(job_id, company_id, agent_id) <= 1);

alter table reports drop constraint if exists reports_source_check;
alter table reports add constraint reports_source_check
  check (source in ('user', 'system'));

-- Bad faith is a kind of dismissal, not a fifth status.
alter table reports drop constraint if exists reports_abusive_is_dismissed;
alter table reports add constraint reports_abusive_is_dismissed
  check (not abusive or status = 'dismissed');

alter table reports drop constraint if exists reports_snapshot_shape;
alter table reports add constraint reports_snapshot_shape
  check (jsonb_typeof(target_snapshot) = 'object' and pg_column_size(target_snapshot) <= 8192);

alter table reports
  drop constraint if exists reports_job_id_fkey,
  add  constraint reports_job_id_fkey
       foreign key (job_id) references jobs (id) on delete set null;

alter table reports
  drop constraint if exists reports_company_id_fkey,
  add  constraint reports_company_id_fkey
       foreign key (company_id) references companies (id) on delete set null;

alter table reports
  drop constraint if exists reports_agent_id_fkey,
  add  constraint reports_agent_id_fkey
       foreign key (agent_id) references agent_profiles (id) on delete set null;

-- What the reporter alleged, ranked. Stored so the queue can filter and sort
-- on it with an index rather than re-deriving it per row.
alter table reports add column if not exists severity smallint generated always as (
  case
    when reason in ('scam', 'impersonation', 'harassment', 'fake_listing') then 3
    when reason in ('misleading_pay', 'discriminatory', 'inappropriate', 'suspicious_company') then 2
    else 1
  end
) stored;

create index if not exists reports_target_idx on reports (target_type, target_id, status);
create index if not exists reports_open_severity_idx
  on reports (severity desc, created_at) where status in ('open', 'investigating');

-- A platform flag is raised once per target until somebody looks at it.
create unique index if not exists reports_one_open_system_flag
  on reports (target_type, target_id)
  where source = 'system' and status in ('open', 'investigating');

comment on column reports.target_snapshot is
  'What the report was about, as it stood when reported: title or name, the '
  'owning company and an excerpt. Written by reports_01_prepare, fixed after.';
comment on column reports.severity is
  'From the reason alone: 3 fraud or harm alleged, 2 misleading or offensive, '
  '1 quality. Ranks the queue; decides nothing.';

-- ---------------------------------------------------------------------------
-- Before a report is stored: its target, its snapshot, its source
--
-- Named 01 so it runs before migration 317's status sync (05), the date stamp
-- (05) and the daily cap (10). Nothing a client sends for the snapshot, the
-- source or the bad-faith flag is kept: a caller could otherwise file a
-- "system" report, or a snapshot of an advert that never said it.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if num_nonnulls(new.job_id, new.company_id, new.agent_id) <> 1 then
    raise exception 'report_target_required'
      using hint = 'A report is about exactly one listing, company or consultant profile.';
  end if;

  new.target_type := case when new.job_id is not null then 'job'
                          when new.company_id is not null then 'company'
                          else 'agent' end;
  new.target_id   := coalesce(new.job_id, new.company_id, new.agent_id);
  new.abusive     := false;
  new.source      := case
                       when coalesce(current_setting('app.system_report', true), 'off') = 'on' then 'system'
                       else 'user'
                     end;

  if new.target_type = 'job' then
    select jsonb_build_object(
             'label_ar', j.title_ar, 'label_en', j.title_en, 'slug', j.slug,
             'status', j.status, 'company_id', j.company_id,
             'company_name_ar', c.name_ar, 'company_name_en', c.name_en,
             'excerpt', left(j.description_ar, 600))
      into v_snapshot
      from jobs j
      join companies c on c.id = j.company_id
     where j.id = new.job_id;
  elsif new.target_type = 'company' then
    select jsonb_build_object(
             'label_ar', c.name_ar, 'label_en', c.name_en, 'slug', c.slug,
             'company_id', c.id, 'website', c.website,
             'verification_status', c.verification_status,
             'excerpt', left(coalesce(c.about_ar, c.about_en), 600))
      into v_snapshot
      from companies c
     where c.id = new.company_id;
  else
    select jsonb_build_object(
             'label_ar', coalesce(p.full_name, a.slug), 'label_en', coalesce(p.full_name, a.slug),
             'slug', a.slug, 'user_id', a.user_id, 'visibility', a.visibility,
             'excerpt', left(coalesce(a.headline_ar, a.headline_en), 300))
      into v_snapshot
      from agent_profiles a
      left join profiles p on p.id = a.user_id
     where a.id = new.agent_id;
  end if;

  new.target_snapshot := coalesce(v_snapshot, '{}'::jsonb);
  return new;
end;
$$;

revoke execute on function public.prepare_report() from public, anon, authenticated;

drop trigger if exists reports_01_prepare on reports;
create trigger reports_01_prepare
  before insert on reports
  for each row execute function public.prepare_report();

-- Once filed, what was reported and why is fixed. The live target link may
-- still null out (that is the delete leaving the record behind), and the
-- reporter link may null out (that is the reporter's own account going).
create or replace function public.keep_report_evidence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.target_type, new.target_id, new.target_snapshot, new.reason, new.detail,
      new.created_at, new.source)
     is distinct from
     (old.target_type, old.target_id, old.target_snapshot, old.reason, old.detail,
      old.created_at, old.source)
  then
    raise exception 'report_evidence_is_fixed'
      using hint = 'What was reported, and why, cannot be edited after the report is filed.';
  end if;

  if new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null then
    raise exception 'report_evidence_is_fixed' using hint = 'A report cannot change hands.';
  end if;

  if (new.job_id is distinct from old.job_id and new.job_id is not null)
     or (new.company_id is distinct from old.company_id and new.company_id is not null)
     or (new.agent_id is distinct from old.agent_id and new.agent_id is not null) then
    raise exception 'report_evidence_is_fixed' using hint = 'A report cannot be moved to another target.';
  end if;

  return new;
end;
$$;

revoke execute on function public.keep_report_evidence() from public, anon, authenticated;

drop trigger if exists reports_02_keep_evidence on reports;
create trigger reports_02_keep_evidence
  before update on reports
  for each row execute function public.keep_report_evidence();

-- ---------------------------------------------------------------------------
-- Reporting bans
--
-- An admin decision about one person's ability to report, kept out of
-- profiles so no profile form, policy or restated guard can reach it. Only an
-- admin reads it; the restricted person learns only that reporting is
-- unavailable, which the refusal below tells them.
-- ---------------------------------------------------------------------------

create table if not exists reporting_restrictions (
  user_id       uuid primary key references profiles (id) on delete cascade,
  reason        text not null check (length(btrim(reason)) between 3 and 500),
  restricted_by uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists reporting_restrictions_by_idx on reporting_restrictions (restricted_by);

alter table reporting_restrictions enable row level security;

drop policy if exists reporting_restrictions_admin_read on reporting_restrictions;
create policy reporting_restrictions_admin_read on reporting_restrictions
  for select using ((select public.is_admin()));

revoke all on reporting_restrictions from anon;
revoke insert, update, delete, truncate on reporting_restrictions from authenticated;

-- ---------------------------------------------------------------------------
-- The limits
--
-- Only a person's report meets them; a platform flag (source = system) is not
-- somebody using the queue. Runs after the daily cap (10), under a lock per
-- reporter, so two reports sent at the same instant are counted one after the
-- other instead of both slipping under a limit together.
--
--   burst            3 in 10 minutes
--   new account      3 in its first day
--   one company      3 in 7 days about one company or its listings
--   own target       none about a company you belong to, its listings, or
--                    your own consultant profile
--   banned           none while an admin's reporting ban stands
-- ---------------------------------------------------------------------------

create or replace function public.guard_report_abuse()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_burst_cap    constant int := 3;
  v_burst_window constant interval := interval '10 minutes';
  v_fresh_cap    constant int := 3;
  v_fresh_age    constant interval := interval '1 day';
  v_company_cap  constant int := 3;
  v_company_win  constant interval := interval '7 days';
  v_company      uuid;
  v_since        timestamptz;
begin
  -- A person using the product, not the platform's own writes (seeds, the
  -- service role, a migration), which have no session to limit.
  if new.source <> 'user' or new.reporter_id is null or public.acting_as_admin() then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || new.reporter_id::text, 0));

  if exists (select 1 from reporting_restrictions where user_id = new.reporter_id) then
    raise exception 'reporting_restricted'
      using hint = 'Reporting is not available on this account.';
  end if;

  v_company := case new.target_type
                 when 'job'     then (new.target_snapshot ->> 'company_id')::uuid
                 when 'company' then new.target_id
               end;

  if v_company is not null and exists (
       select 1 from company_members where company_id = v_company and user_id = new.reporter_id) then
    raise exception 'report_own_target' using hint = 'You cannot report your own company or its listings.';
  end if;
  if new.target_type = 'agent' and (new.target_snapshot ->> 'user_id')::uuid = new.reporter_id then
    raise exception 'report_own_target' using hint = 'You cannot report your own profile.';
  end if;

  if (select count(*) from reports
       where reporter_id = new.reporter_id
         and created_at > now() - v_burst_window) >= v_burst_cap then
    raise exception 'report_burst_limit'
      using hint = 'Several reports in a few minutes. Try again shortly.';
  end if;

  select created_at into v_since from profiles where id = new.reporter_id;
  if v_since > now() - v_fresh_age
     and (select count(*) from reports
           where reporter_id = new.reporter_id
             and created_at > now() - v_fresh_age) >= v_fresh_cap then
    raise exception 'report_new_account_limit'
      using hint = 'A new account can send a few reports on its first day.';
  end if;

  if v_company is not null
     and (select count(*) from reports r
           where r.reporter_id = new.reporter_id
             and r.created_at > now() - v_company_win
             and ((r.target_type = 'company' and r.target_id = v_company)
               or (r.target_type = 'job' and r.target_snapshot ->> 'company_id' = v_company::text))
         ) >= v_company_cap then
    raise exception 'report_company_limit'
      using hint = 'Several reports about this company already; they are reviewed together.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_report_abuse() from public, anon, authenticated;

drop trigger if exists reports_12_guard_abuse on reports;
create trigger reports_12_guard_abuse
  before insert on reports
  for each row execute function public.guard_report_abuse();

-- ---------------------------------------------------------------------------
-- A platform flag, raised for a person to look at
--
-- Used by migration 327 when a company's own text carries the marks of a scam
-- or of somebody else's name. Raised once per target until it is closed, and
-- not raised again for text a moderator already dismissed.
-- ---------------------------------------------------------------------------

create or replace function public.raise_system_report(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text,
  p_detail      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from reports
              where target_type = p_target_type and target_id = p_target_id and source = 'system'
                and (status in ('open', 'investigating')
                     or (status = 'dismissed' and detail is not distinct from left(p_detail, 1000)))) then
    return;
  end if;

  perform set_config('app.system_report', 'on', true);
  insert into reports (job_id, company_id, agent_id, reporter_id, reason, detail)
  values (case when p_target_type = 'job' then p_target_id end,
          case when p_target_type = 'company' then p_target_id end,
          case when p_target_type = 'agent' then p_target_id end,
          null, p_reason, left(p_detail, 1000))
  on conflict do nothing;
  perform set_config('app.system_report', 'off', true);
end;
$$;

revoke execute on function public.raise_system_report(text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The reporter is told, in one sentence and without detail
--
-- "We reviewed your report" and whether it led to action. Never what action,
-- never anything about the account reported, and nothing when a report is
-- marked bad faith beyond the same neutral sentence a dismissal gets.
-- ---------------------------------------------------------------------------

create or replace function public.tell_reporter_outcome()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source <> 'user' or new.reporter_id is null then
    return null;
  end if;
  if not (old.status in ('open', 'investigating') and new.status in ('resolved', 'dismissed')) then
    return null;
  end if;

  perform public.moderation_notify(
    new.reporter_id,
    'report_reviewed',
    jsonb_build_object(
      'target_type', new.target_type,
      'title_ar',    new.target_snapshot ->> 'label_ar',
      'title_en',    new.target_snapshot ->> 'label_en',
      'outcome',     case when new.status = 'resolved' then 'actioned' else 'reviewed' end),
    null);
  return null;
end;
$$;

revoke execute on function public.tell_reporter_outcome() from public, anon, authenticated;

drop trigger if exists reports_91_tell_reporter on reports;
create trigger reports_91_tell_reporter
  after update on reports
  for each row execute function public.tell_reporter_outcome();

-- ---------------------------------------------------------------------------
-- Levers
-- ---------------------------------------------------------------------------

-- Acts on reports by id: the ones whose target has been deleted (which the
-- per-target lever of migration 318 can no longer find), and single reports
-- marked as filed in bad faith.
create or replace function public.admin_close_reports(
  p_reports uuid[],
  p_status  text,
  p_note    text default null,
  p_abusive boolean default false
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note   text;
  v_moved  int := 0;
  v_groups jsonb;
  v_row    record;
begin
  perform public.admin_begin();

  if p_status not in ('investigating', 'resolved', 'dismissed') then
    raise exception 'invalid_action';
  end if;
  if p_abusive and p_status <> 'dismissed' then
    raise exception 'invalid_action' using hint = 'Only a dismissal can say a report was filed in bad faith.';
  end if;
  if coalesce(cardinality(p_reports), 0) = 0 or cardinality(p_reports) > 200 then
    raise exception 'invalid_action';
  end if;

  v_note := public.admin_reason(p_note, p_abusive);

  -- Locked first, so a second moderator pressing the same button waits and
  -- then finds nothing left to move.
  perform 1 from reports where id = any (p_reports) for update;

  -- Moved and grouped in one statement; a loop cannot read a data-modifying
  -- CTE directly (it runs as a cursor), so the groups come back as rows of a
  -- small JSON array.
  with moved as (
    update reports
       set status = p_status,
           abusive = p_abusive,
           resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() end
     where id = any (p_reports)
       and status in ('open', 'investigating')
       and status is distinct from p_status
    returning target_type, target_id, target_snapshot ->> 'label_ar' as label
  )
  select coalesce(jsonb_agg(jsonb_build_object('type', g.target_type, 'id', g.target_id,
                                               'n', g.n, 'label', g.label)), '[]'::jsonb)
    into v_groups
    from (select target_type, target_id, count(*) as n, (array_agg(label))[1] as label
            from moved
           group by target_type, target_id) g;

  for v_row in select * from jsonb_to_recordset(v_groups) as x(type text, id uuid, n int, label text) loop
    v_moved := v_moved + v_row.n;
    perform public.admin_audit(
      case when p_abusive then 'report.dismissed_abusive' else 'report.' || p_status end,
      v_row.type, v_row.id::text, v_row.label, v_note,
      jsonb_build_object('reports', v_row.n, 'by', 'id'));
  end loop;

  if v_moved = 0 then
    raise exception 'not_found' using hint = 'Nothing open among these reports; somebody may have handled them already.';
  end if;

  return v_moved;
end;
$$;

create or replace function public.admin_set_reporting_restriction(
  p_user     uuid,
  p_restrict boolean,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_name   text;
begin
  perform public.admin_begin();

  if p_user = auth.uid() then
    raise exception 'forbidden' using hint = 'An admin cannot change their own reporting.';
  end if;

  select full_name into v_name from profiles where id = p_user and role <> 'admin' for update;
  if not found then
    raise exception 'not_found';
  end if;

  v_reason := public.admin_reason(p_reason, true);

  if p_restrict then
    insert into reporting_restrictions (user_id, reason, restricted_by)
    values (p_user, v_reason, auth.uid())
    on conflict (user_id) do nothing;
    if not found then
      raise exception 'no_change' using hint = 'Reporting is already restricted for this account.';
    end if;
  else
    delete from reporting_restrictions where user_id = p_user;
    if not found then
      raise exception 'no_change' using hint = 'Reporting is not restricted for this account.';
    end if;
  end if;

  perform public.admin_audit(
    case when p_restrict then 'user.reporting_restricted' else 'user.reporting_restored' end,
    'user', p_user::text, v_name, v_reason, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading the queue
--
-- One case per thing reported, ranked by what was alleged, then by how many
-- different people said it, then by who has waited longest. Aggregated here
-- rather than in the page, which used to draw five hundred rows to group them.
--
--   new           cases with at least one report nobody has picked up
--   under_review  cases where every open report is being investigated
--
-- Reporter context is counted, not named: how many of a case's reporters are
-- under a week old, how many have a record of reports found groundless or in
-- bad faith, how many are employers — the three facts that separate a real
-- pile of complaints from a pile-on.
-- ---------------------------------------------------------------------------

create or replace function public.admin_report_cases(
  p_view          text default 'new',
  p_type          text default null,
  p_reason        text default null,
  p_min_severity  int  default null,
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_min_reporters int  default null,
  p_target        uuid default null,
  p_limit         int  default 20,
  p_offset        int  default 0
)
returns table (
  target_type           text,
  target_id             uuid,
  label_ar              text,
  label_en              text,
  company_id            uuid,
  company_name_ar       text,
  company_name_en       text,
  target_state          text,
  reports               int,
  reporters             int,
  open_reports          int,
  investigating_reports int,
  system_flags          int,
  max_severity          int,
  reasons               text[],
  first_at              timestamptz,
  last_at               timestamptz,
  fresh_reporters       int,
  noisy_reporters       int,
  employer_reporters    int,
  report_ids            uuid[],
  total_count           bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_view not in ('new', 'under_review') then
    raise exception 'invalid_action';
  end if;
  if p_type is not null and p_type not in ('job', 'company', 'agent') then
    raise exception 'invalid_action';
  end if;

  return query
  with active as (
    select r.*
      from reports r
     where r.status in ('open', 'investigating')
       and (p_type is null or r.target_type = p_type)
       and (p_target is null or r.target_id = p_target)
  ),
  history as (
    select h.reporter_id,
           count(*) as filed,
           count(*) filter (where h.status = 'dismissed') as dismissed,
           count(*) filter (where h.abusive) as abusive
      from reports h
     where h.reporter_id in (select a.reporter_id from active a where a.reporter_id is not null)
     group by h.reporter_id
  ),
  cases as (
    select a.target_type as c_type,
           a.target_id   as c_id,
           count(*)::int as c_reports,
           count(distinct a.reporter_id)::int as c_reporters,
           count(*) filter (where a.status = 'open')::int as c_open,
           count(*) filter (where a.status = 'investigating')::int as c_investigating,
           count(*) filter (where a.source = 'system')::int as c_system,
           max(a.severity)::int as c_severity,
           array_agg(distinct a.reason) as c_reasons,
           min(a.created_at) as c_first,
           max(a.created_at) as c_last,
           count(distinct a.reporter_id) filter (
             where p.created_at > a.created_at - interval '7 days')::int as c_fresh,
           count(distinct a.reporter_id) filter (
             where h.abusive > 0 or (h.filed >= 3 and h.dismissed * 2 >= h.filed))::int as c_noisy,
           count(distinct a.reporter_id) filter (where p.role = 'employer')::int as c_employers,
           array_agg(a.id order by a.created_at) as c_ids,
           bool_or((p_from is null or a.created_at >= p_from)
               and (p_to is null or a.created_at < p_to)) as c_in_range,
           (array_agg(a.target_snapshot order by a.created_at desc))[1] as c_snapshot
      from active a
      left join profiles p on p.id = a.reporter_id
      left join history h on h.reporter_id = a.reporter_id
     group by a.target_type, a.target_id
  ),
  filtered as (
    select c.*
      from cases c
     where ((p_view = 'new' and c.c_open > 0) or (p_view = 'under_review' and c.c_open = 0))
       and (p_reason is null or p_reason = any (c.c_reasons))
       and (p_min_severity is null or c.c_severity >= p_min_severity)
       and c.c_in_range
       and (p_min_reporters is null or c.c_reporters >= p_min_reporters)
  )
  select f.c_type,
         f.c_id,
         coalesce(j.title_ar, co.name_ar, agp.full_name, f.c_snapshot ->> 'label_ar'),
         coalesce(j.title_en, co.name_en, agp.full_name, f.c_snapshot ->> 'label_en'),
         coalesce(j.company_id, co.id, (f.c_snapshot ->> 'company_id')::uuid),
         coalesce(jc.name_ar, co.name_ar, f.c_snapshot ->> 'company_name_ar'),
         coalesce(jc.name_en, co.name_en, f.c_snapshot ->> 'company_name_en'),
         case f.c_type
           when 'job' then case when j.id is null then 'deleted'
                                when jc.suspended_at is not null then 'company_suspended'
                                else j.status::text end
           when 'company' then case when co.id is null then 'deleted'
                                    when co.suspended_at is not null then 'suspended'
                                    else 'listed' end
           else case when ag.id is null then 'deleted'
                     when ag.restricted_at is not null then 'restricted'
                     else ag.visibility::text end
         end,
         f.c_reports, f.c_reporters, f.c_open, f.c_investigating, f.c_system,
         f.c_severity, f.c_reasons, f.c_first, f.c_last,
         f.c_fresh, f.c_noisy, f.c_employers, f.c_ids,
         count(*) over ()
    from filtered f
    left join jobs j            on f.c_type = 'job' and j.id = f.c_id
    left join companies jc      on jc.id = j.company_id
    left join companies co      on f.c_type = 'company' and co.id = f.c_id
    left join agent_profiles ag on f.c_type = 'agent' and ag.id = f.c_id
    left join profiles agp      on agp.id = ag.user_id
   order by f.c_severity desc, f.c_reporters desc, f.c_first asc, f.c_type, f.c_id
   limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end;
$$;

-- The rows behind a case — or, with no ids, the closed ones, filtered and
-- paged — each with what the moderator needs to weigh the person who sent it.
create or replace function public.admin_report_rows(
  p_ids          uuid[] default null,
  p_status       text default null,
  p_type         text default null,
  p_reason       text default null,
  p_min_severity int  default null,
  p_from         timestamptz default null,
  p_to           timestamptz default null,
  p_limit        int  default 30,
  p_offset       int  default 0
)
returns table (
  id                  uuid,
  target_type         text,
  target_id           uuid,
  target_live         boolean,
  reason              text,
  severity            int,
  detail              text,
  status              text,
  source              text,
  abusive             boolean,
  created_at          timestamptz,
  resolved_at         timestamptz,
  target_snapshot     jsonb,
  reporter_id         uuid,
  reporter_name       text,
  reporter_role       user_role,
  reporter_since      timestamptz,
  reporter_company_ar text,
  reporter_company_en text,
  reporter_filed      int,
  reporter_dismissed  int,
  reporter_abusive    int,
  reporter_restricted boolean,
  total_count         bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ids is null and (p_status is null or p_status not in ('open', 'investigating', 'resolved', 'dismissed')) then
    raise exception 'invalid_action';
  end if;
  if p_ids is not null and cardinality(p_ids) > 500 then
    raise exception 'invalid_action';
  end if;

  return query
  select r.id, r.target_type, r.target_id,
         num_nonnulls(r.job_id, r.company_id, r.agent_id) = 1,
         r.reason, r.severity::int, r.detail, r.status, r.source, r.abusive,
         r.created_at, r.resolved_at, r.target_snapshot,
         r.reporter_id, p.full_name, p.role, p.created_at,
         rc.name_ar, rc.name_en,
         coalesce(h.filed, 0)::int, coalesce(h.dismissed, 0)::int, coalesce(h.abusive, 0)::int,
         exists (select 1 from reporting_restrictions x where x.user_id = r.reporter_id),
         count(*) over ()
    from reports r
    left join profiles p on p.id = r.reporter_id
    left join lateral (
      select c.name_ar, c.name_en
        from company_members m join companies c on c.id = m.company_id
       where m.user_id = r.reporter_id
       order by (m.role = 'admin') desc, m.created_at
       limit 1
    ) rc on true
    left join lateral (
      select count(*) as filed,
             count(*) filter (where o.status = 'dismissed') as dismissed,
             count(*) filter (where o.abusive) as abusive
        from reports o
       where o.reporter_id = r.reporter_id
    ) h on r.reporter_id is not null
   where (p_ids is null or r.id = any (p_ids))
     and (p_ids is not null or r.status = p_status)
     and (p_type is null or r.target_type = p_type)
     and (p_reason is null or r.reason = p_reason)
     and (p_min_severity is null or r.severity >= p_min_severity)
     and (p_from is null or r.created_at >= p_from)
     and (p_to is null or r.created_at < p_to)
   order by case when p_ids is null then coalesce(r.resolved_at, r.created_at) end desc nulls last,
            r.created_at, r.id
   limit case when p_ids is null then greatest(1, least(p_limit, 100)) else 500 end
   offset case when p_ids is null then greatest(0, p_offset) else 0 end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. Every function above checks is_admin() itself; the
-- grants are the second lock (and anon's explicit grant is what Supabase
-- hands out at creation, so it is revoked by name).
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_close_reports(uuid[], text, text, boolean)          from public, anon;
revoke execute on function public.admin_set_reporting_restriction(uuid, boolean, text)       from public, anon;
revoke execute on function public.admin_report_cases(text, text, text, int, timestamptz, timestamptz, int, uuid, int, int) from public, anon;
revoke execute on function public.admin_report_rows(uuid[], text, text, text, int, timestamptz, timestamptz, int, int) from public, anon;

grant execute on function public.admin_close_reports(uuid[], text, text, boolean)          to authenticated;
grant execute on function public.admin_set_reporting_restriction(uuid, boolean, text)       to authenticated;
grant execute on function public.admin_report_cases(text, text, text, int, timestamptz, timestamptz, int, uuid, int, int) to authenticated;
grant execute on function public.admin_report_rows(uuid[], text, text, text, int, timestamptz, timestamptz, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback, by hand, after 328 and 327. Reports whose target was deleted have
-- no live link and would fail the old one-target check: delete or relink them
-- first.
--
--   drop trigger if exists reports_91_tell_reporter on reports;
--   drop trigger if exists reports_12_guard_abuse on reports;
--   drop trigger if exists reports_02_keep_evidence on reports;
--   drop trigger if exists reports_01_prepare on reports;
--   drop function if exists public.admin_report_rows(uuid[], text, text, text, int, timestamptz, timestamptz, int, int);
--   drop function if exists public.admin_report_cases(text, text, text, int, timestamptz, timestamptz, int, uuid, int, int);
--   drop function if exists public.admin_set_reporting_restriction(uuid, boolean, text);
--   drop function if exists public.admin_close_reports(uuid[], text, text, boolean);
--   drop function if exists public.tell_reporter_outcome();
--   drop function if exists public.raise_system_report(text, uuid, text, text);
--   drop function if exists public.guard_report_abuse();
--   drop function if exists public.keep_report_evidence();
--   drop function if exists public.prepare_report();
--   drop function if exists public.moderation_notify_company(uuid, notification_kind, jsonb, text);
--   drop function if exists public.moderation_notify(uuid, notification_kind, jsonb, text);
--   drop table if exists reporting_restrictions;
--   drop index if exists reports_one_open_system_flag, reports_open_severity_idx, reports_target_idx;
--   alter table reports
--     drop constraint if exists reports_target_agrees,
--     drop constraint if exists reports_target_type_check,
--     drop constraint if exists reports_source_check,
--     drop constraint if exists reports_abusive_is_dismissed,
--     drop constraint if exists reports_snapshot_shape,
--     drop constraint if exists reports_one_target,
--     add constraint reports_one_target check (num_nonnulls(job_id, company_id, agent_id) = 1);
--   alter table reports
--     drop constraint reports_job_id_fkey,
--     add constraint reports_job_id_fkey foreign key (job_id) references jobs (id) on delete cascade,
--     drop constraint reports_company_id_fkey,
--     add constraint reports_company_id_fkey foreign key (company_id) references companies (id) on delete cascade,
--     drop constraint reports_agent_id_fkey,
--     add constraint reports_agent_id_fkey foreign key (agent_id) references agent_profiles (id) on delete cascade;
--   alter table reports
--     drop column severity, drop column abusive, drop column source,
--     drop column target_snapshot, drop column target_id, drop column target_type;
-- ---------------------------------------------------------------------------
