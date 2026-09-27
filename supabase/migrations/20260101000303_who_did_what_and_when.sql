-- =============================================================================
-- 303 — Who did what, and when
--
-- Every privileged action on this platform changed a row and left nothing
-- else behind. An account approved, a company verified, a listing taken down,
-- a role changed: the row said what was now true and nothing said who made it
-- so, or what it had been the moment before. When the question is "why is
-- this brokerage verified" or "who suspended this consultant", the only
-- answer was the row's current state, which is the one fact nobody was asking.
--
-- Two tables, for two different readers.
--
-- audit_log is the trail of decisions: role and approval changes, company
-- verification, listing moderation, team membership, a consultant changing
-- who may see them. Written by triggers on the tables themselves, so the log
-- cannot be skipped by an action that forgot to call it, and every row names
-- the actor, the target, and the before and after. Identifiers and states
-- only — never a note's text, never a phone number, never a document.
--
-- security_events is what the platform noticed rather than what somebody
-- decided: a rate limit tripped, an upload refused, a run of failed sign-ins.
-- Written by the application through the service role, and by the database
-- functions that do the refusing. Subjects arrive pre-hashed — an IP or an
-- address is hashed with a salt before it reaches this table, because a
-- security log that is itself a list of personal data is a second breach
-- waiting inside the first.
--
-- Both are readable by admins alone and writable by nobody through the API:
-- the only writers are the SECURITY DEFINER helpers below.
-- =============================================================================

-- rollback: drop trigger if exists profiles_95_security_audit on profiles; drop trigger if exists companies_95_security_audit on companies; drop trigger if exists jobs_95_security_audit on jobs; drop trigger if exists company_members_95_security_audit on company_members; drop trigger if exists agent_profiles_95_security_audit on agent_profiles; drop trigger if exists reports_95_security_audit on reports; drop function if exists public.audit_profile_changes, public.audit_company_changes, public.audit_job_changes, public.audit_membership_changes, public.audit_agent_visibility, public.audit_report_resolution, public.audit, public.record_security_event, public.request_role; drop table if exists audit_log, security_events;
-- safety: ships-with-code — the triggers only insert into two new tables and never
--   refuse a write, and the one page that reads them (/admin/security) is admin-only
--   and shows an empty page until this has run, so either order is safe.

create table audit_log (
  id           bigserial primary key,
  actor_id     uuid,
  -- 'admin', 'authenticated', 'anon' or 'service_role'. Recorded rather than
  -- looked up later, because a person's role can change after the fact and
  -- the log has to say what they were when they acted.
  actor_role   text not null,
  action       text not null,
  target_type  text not null,
  target_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint audit_log_action_length   check (length(action) between 1 and 80),
  constraint audit_log_target_length   check (length(target_type) between 1 and 40)
);

create index audit_log_recent_idx on audit_log (created_at desc);
create index audit_log_target_idx on audit_log (target_type, target_id, created_at desc);
create index audit_log_actor_idx  on audit_log (actor_id, created_at desc) where actor_id is not null;

alter table audit_log enable row level security;

create policy audit_log_admin_read on audit_log
  for select using (public.is_admin());

create table security_events (
  id           bigserial primary key,
  kind         text not null,
  severity     text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  actor_id     uuid,
  -- A salted hash of the IP address or email address the event is about.
  -- Enough to see that one source is behind fifty events; not enough to say
  -- who it was from this table alone.
  subject_hash text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint security_events_kind_length    check (length(kind) between 1 and 80),
  constraint security_events_subject_length check (subject_hash is null or length(subject_hash) <= 128)
);

create index security_events_recent_idx  on security_events (created_at desc);
create index security_events_kind_idx    on security_events (kind, created_at desc);
create index security_events_subject_idx on security_events (subject_hash, created_at desc)
  where subject_hash is not null;

alter table security_events enable row level security;

create policy security_events_admin_read on security_events
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- The writers
-- ---------------------------------------------------------------------------

/** The role behind the current request, as PostgREST reports it. */
create or replace function public.request_role()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'service_role'
  );
$$;

revoke execute on function public.request_role() from public, anon, authenticated;

create or replace function public.audit(
  p_action      text,
  p_target_type text,
  p_target_id   text,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (actor_id, actor_role, action, target_type, target_id, metadata)
  values (
    auth.uid(),
    case
      when public.request_role() = 'service_role' then 'service_role'
      when public.is_admin() then 'admin'
      else public.request_role()
    end,
    p_action,
    p_target_type,
    p_target_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.audit(text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.record_security_event(
  p_kind         text,
  p_severity     text default 'info',
  p_subject_hash text default null,
  p_metadata     jsonb default '{}'::jsonb,
  p_actor        uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into security_events (kind, severity, actor_id, subject_hash, metadata)
  values (
    p_kind,
    case when p_severity in ('info', 'warning', 'critical') then p_severity else 'info' end,
    coalesce(p_actor, auth.uid()),
    p_subject_hash,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.record_security_event(text, text, text, jsonb, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The decisions, recorded where they are made
-- ---------------------------------------------------------------------------

-- Main's migration 203 owns the *_90_audit triggers for audit_events. Keep
-- those intact and use later names for this separate security audit ledger.
create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    perform public.audit('profile.role_changed', 'profile', new.id::text,
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;

  if new.approval_status is distinct from old.approval_status then
    perform public.audit('account.approval_changed', 'profile', new.id::text,
      jsonb_build_object('from', old.approval_status, 'to', new.approval_status));
  end if;

  return new;
end;
$$;

create trigger profiles_95_security_audit
  after update on profiles
  for each row execute function public.audit_profile_changes();

create or replace function public.audit_company_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is distinct from old.verification_status then
    perform public.audit('company.verification_changed', 'company', new.id::text,
      jsonb_build_object('from', old.verification_status, 'to', new.verification_status));
  end if;

  if new.post_credits is distinct from old.post_credits then
    perform public.audit('company.credits_changed', 'company', new.id::text,
      jsonb_build_object('from', old.post_credits, 'to', new.post_credits));
  end if;

  return new;
end;
$$;

create trigger companies_95_security_audit
  after update on companies
  for each row execute function public.audit_company_changes();

create or replace function public.audit_job_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Moderation is the transition the owner cannot make; anything into
  -- `active` or `rejected` is a reviewer's decision, or the cron's.
  if new.status is distinct from old.status and new.status in ('active', 'rejected') then
    perform public.audit('job.moderated', 'job', new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status, 'company_id', new.company_id));
  end if;

  if new.is_featured is distinct from old.is_featured then
    perform public.audit('job.featured_changed', 'job', new.id::text,
      jsonb_build_object('featured', new.is_featured));
  end if;

  return new;
end;
$$;

create trigger jobs_95_security_audit
  after update on jobs
  for each row execute function public.audit_job_changes();

create or replace function public.audit_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('company.member_added', 'company', new.company_id::text,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.audit('company.member_removed', 'company', old.company_id::text,
      jsonb_build_object('user_id', old.user_id, 'role', old.role));
    return old;
  elsif new.role is distinct from old.role then
    perform public.audit('company.member_role_changed', 'company', new.company_id::text,
      jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
  end if;
  return new;
end;
$$;

create trigger company_members_95_security_audit
  after insert or update or delete on company_members
  for each row execute function public.audit_membership_changes();

create or replace function public.audit_agent_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility is distinct from old.visibility then
    perform public.audit('agent.visibility_changed', 'agent_profile', new.id::text,
      jsonb_build_object('from', old.visibility, 'to', new.visibility));
  end if;
  return new;
end;
$$;

create trigger agent_profiles_95_security_audit
  after update on agent_profiles
  for each row execute function public.audit_agent_visibility();

create or replace function public.audit_report_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resolved and not old.resolved then
    perform public.audit('report.resolved', 'job', new.job_id::text,
      jsonb_build_object('report_id', new.id, 'reason', new.reason));
  end if;
  return new;
end;
$$;

create trigger reports_95_security_audit
  after update on reports
  for each row execute function public.audit_report_resolution();

-- Trigger functions are the database's to call.
revoke execute on function public.audit_profile_changes()    from public, anon, authenticated;
revoke execute on function public.audit_company_changes()    from public, anon, authenticated;
revoke execute on function public.audit_job_changes()        from public, anon, authenticated;
revoke execute on function public.audit_membership_changes() from public, anon, authenticated;
revoke execute on function public.audit_agent_visibility()   from public, anon, authenticated;
revoke execute on function public.audit_report_resolution()  from public, anon, authenticated;
