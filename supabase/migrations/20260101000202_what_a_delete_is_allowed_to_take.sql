-- =============================================================================
-- 68 — What a delete is allowed to take with it
--
-- The schema was built to cascade, and for most of it that is right: a saved
-- job, a saved search, a notification or a CV section belongs to one person
-- and goes when they go. Three chains did not stop where they should have.
--
--   auth.users -> profiles -> companies -> jobs -> applications
--
-- deleteMyAccount() refuses a company owner in application code, and says why
-- at length: deleting one employer's login would delete every listing the
-- company published and every application other people sent to them. That
-- refusal lived in one server action. Deleting the same user from the
-- Supabase dashboard — the first thing anybody reaches for when asked to
-- "remove this account" — walked straight past it and took the whole chain,
-- including other candidates' records of where they had applied.
--
-- So the rule moves into the table, where every path meets it:
--
--   companies.owner_id      cascade -> restrict. An owner's account cannot be
--                           deleted while the company exists. What happens to
--                           the company is a decision somebody makes on
--                           purpose (see docs/data-lifecycle.md), not a side
--                           effect of closing a login.
--
--   applications.job_id     cascade -> restrict. A listing somebody applied to
--                           is recruitment history for two parties. It closes,
--                           expires or is rejected; it is not deleted out from
--                           under the people who applied. No product path
--                           deletes a job today — this makes sure no future
--                           one, and no hand in the SQL editor, does it
--                           silently.
--
-- And two audit columns with no ON DELETE at all, which meant the opposite
-- failure: an admin who had ever reviewed a document or resolved a report
-- could never be deleted, by any path, because the foreign key refused.
--
--   company_documents.reviewed_by, reports.resolved_by   -> set null, the
--                           rule application_events.actor_id already follows.
--                           The review happened; who did it goes with them.
--
-- Everything here was checked against production before it was written: no
-- row violates any constraint below, so nothing is backfilled.
-- =============================================================================

-- rollback: forward-fix only — applied to production on 2026-09-27 (17:07–17:10 UTC), before any branch carrying it merged; undoing it is a new migration, never an edit to this one
-- safety: ships-with-code — already applied to production on 2026-09-27 (17:07–17:10 UTC); the code on main has run against it since, and this branch's code that reads it can land at any time
-- safety: constraint — applied to production on 2026-09-27 (17:07–17:10 UTC), where Postgres validated every existing row as each foreign key and check was added; nothing has violated them since

alter table companies
  drop constraint if exists companies_owner_id_fkey,
  add  constraint companies_owner_id_fkey
       foreign key (owner_id) references profiles (id) on delete restrict;

alter table applications
  drop constraint if exists applications_job_id_fkey,
  add  constraint applications_job_id_fkey
       foreign key (job_id) references jobs (id) on delete restrict;

alter table company_documents
  drop constraint if exists company_documents_reviewed_by_fkey,
  add  constraint company_documents_reviewed_by_fkey
       foreign key (reviewed_by) references profiles (id) on delete set null;

alter table reports
  drop constraint if exists reports_resolved_by_fkey,
  add  constraint reports_resolved_by_fkey
       foreign key (resolved_by) references profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Stamps that agree with the state they stamp
--
-- Each of these pairs is written together by exactly one path today —
-- verifyCompany writes verified_at beside verification_status, actOnReportedJob
-- resolved_at beside resolved, the review beside reviewed_at — and each pair
-- can disagree the moment a second path writes one half. A company that is
-- verified with no verified_at, or a report resolved with no date, is a row
-- whose two readers will give two answers.
--
-- Deliberately not asserted: approved_at on every approved profile. Fourteen
-- production accounts predate migration 16, were approved by its default, and
-- have no stamp; inventing one would be a date nobody decided on. The
-- constraint below says the direction that is true for all of them — a stamp
-- only ever sits on an approved account.
-- ---------------------------------------------------------------------------

/*
  Kept in step by the table itself, then asserted.

  A bare CHECK would move the work onto every writer: an admin fixing a row in
  the SQL editor, a seed, a test, would each have to remember the date. A
  BEFORE trigger derives it — stamps the moment of arrival, clears it on the
  way out, and leaves an explicitly supplied date alone — so the CHECK below it
  is the backstop for the day somebody rewrites the trigger, not a rule anybody
  meets. Named 05 so it runs ahead of the guards (10+) and the version bump
  (40): the guard then sees the stamp as part of the same change it is judging.

  One function for four tables, keyed by TG_TABLE_NAME, because the rule is
  one rule.
*/
create or replace function public.stamp_state_dates()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  /*
    Only when the state moves (or on insert). A stamp written by hand with no
    change of state is left exactly as written, so the guard can refuse it
    with its own message and the CHECK can refuse whatever the guard lets
    through — rather than this quietly undoing it and the statement
    "succeeding" at nothing.
  */
  if tg_table_name = 'companies' then
    if tg_op = 'INSERT' or new.verification_status is distinct from old.verification_status then
      if new.verification_status = 'verified' then
        new.verified_at := coalesce(new.verified_at, now());
      else
        new.verified_at := null;
      end if;
    end if;
  elsif tg_table_name = 'profiles' then
    if (tg_op = 'INSERT' or new.approval_status is distinct from old.approval_status)
       and new.approval_status <> 'approved' then
      new.approved_at := null;
    end if;
  elsif tg_table_name = 'reports' then
    if tg_op = 'INSERT' or new.resolved is distinct from old.resolved then
      if new.resolved then
        new.resolved_at := coalesce(new.resolved_at, now());
      else
        new.resolved_at := null;
      end if;
    end if;
  elsif tg_table_name = 'company_documents' then
    if (tg_op = 'INSERT' or new.status is distinct from old.status)
       and new.status <> 'pending' then
      new.reviewed_at := coalesce(new.reviewed_at, now());
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_state_dates() from public, anon, authenticated;

drop trigger if exists companies_05_stamp_dates on companies;
create trigger companies_05_stamp_dates
  before insert or update of verification_status, verified_at on companies
  for each row execute function public.stamp_state_dates();

drop trigger if exists profiles_05_stamp_dates on profiles;
create trigger profiles_05_stamp_dates
  before insert or update of approval_status, approved_at on profiles
  for each row execute function public.stamp_state_dates();

drop trigger if exists reports_05_stamp_dates on reports;
create trigger reports_05_stamp_dates
  before insert or update of resolved, resolved_at on reports
  for each row execute function public.stamp_state_dates();

drop trigger if exists company_documents_05_stamp_dates on company_documents;
create trigger company_documents_05_stamp_dates
  before insert or update of status, reviewed_at on company_documents
  for each row execute function public.stamp_state_dates();

alter table profiles
  add constraint profiles_approved_at_only_when_approved
  check (approval_status = 'approved' or approved_at is null);

alter table companies
  add constraint companies_verified_at_matches_status
  check ((verification_status = 'verified') = (verified_at is not null));

alter table reports
  add constraint reports_resolution_is_dated
  check (resolved = (resolved_at is not null));

alter table company_documents
  add constraint company_documents_review_is_dated
  check (status = 'pending' or reviewed_at is not null);

-- An order that grants nothing is not an order.
alter table orders
  add constraint orders_credits_positive check (credits > 0);

alter table email_log
  add constraint email_log_attempts_nonnegative check (attempts >= 0);

-- A notification links inside the product, locale-free, and its payload is the
-- object the renderer destructures. Every trigger writes exactly that; this is
-- what stops a future one writing an absolute URL into somebody's bell.
alter table notifications
  add constraint notifications_href_is_local
  check (href is null or (href like '/%' and length(href) <= 500)),
  add constraint notifications_payload_is_object
  check (jsonb_typeof(payload) = 'object');

-- A history row records a move. The trigger only writes one when the status
-- changed; this makes that the table's rule too.
alter table application_events
  add constraint application_events_is_a_move
  check (from_status is distinct from to_status);

-- A live listing was published at some moment. stamp_job_publication
-- guarantees it; migration 64 made the same argument for expires_at.
alter table jobs
  add constraint jobs_active_was_published
  check (status <> 'active' or published_at is not null);

-- ---------------------------------------------------------------------------
-- An audit trail that is not the notification feed
--
-- The bell is a person's inbox: they may delete from it, and it will be pruned
-- (migration 69). It was also, until now, the only durable trace of the
-- decisions that matter afterwards — an account suspended, a company
-- verified, a listing taken down. Those are facts about the platform's own
-- conduct, and they have to survive the feed being tidied.
--
-- Thin on purpose: who, what, to which row, and the states involved. No names,
-- no phone numbers, no text anybody typed — the moderation note stays on the
-- row it was written on. subject_id carries no foreign key, because the most
-- important row this table holds is the one recording that its subject was
-- deleted.
-- ---------------------------------------------------------------------------

create table if not exists audit_events (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  -- Null for the system (cron, migrations, the service role) and once the
  -- actor's own account is deleted: the decision still happened.
  actor_id     uuid references profiles (id) on delete set null,
  action       text not null check (length(action) between 1 and 60),
  subject_type text not null check (subject_type in ('profile', 'company', 'company_member', 'job', 'company_document')),
  subject_id   uuid not null,
  detail       jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

create index if not exists audit_events_subject_idx on audit_events (subject_type, subject_id, occurred_at);
create index if not exists audit_events_actor_idx   on audit_events (actor_id);
create index if not exists audit_events_recent_idx  on audit_events (occurred_at desc);

alter table audit_events enable row level security;

-- Admins read it. Nobody writes it except the triggers below, which run as
-- their definer; there is no insert, update or delete policy, and that is the
-- control rather than an omission.
drop policy if exists audit_events_admin_read on audit_events;
create policy audit_events_admin_read on audit_events
  for select using (public.is_admin());

comment on table audit_events is
  'Durable record of moderation and account-lifecycle decisions. Written only '
  'by triggers; readable by admins; never pruned by the maintenance job (see '
  'retention_policies, migration 69). Holds ids and states, never personal text.';

create or replace function public.audit(
  p_action       text,
  p_subject_type text,
  p_subject_id   uuid,
  p_detail       jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into audit_events (actor_id, action, subject_type, subject_id, detail)
  select
    -- An actor whose profile is already gone (their own deletion, mid-cascade)
    -- is recorded as nobody rather than failing the statement on the FK.
    (select p.id from profiles p where p.id = (select auth.uid())),
    p_action, p_subject_type, p_subject_id, coalesce(p_detail, '{}'::jsonb);
$$;

revoke execute on function public.audit(text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- profiles ---

create or replace function public.audit_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.audit('account_deleted', 'profile', old.id,
                         jsonb_build_object('role', old.role));
    return old;
  end if;

  if new.approval_status is distinct from old.approval_status then
    perform public.audit('account_approval', 'profile', new.id,
                         jsonb_build_object('from', old.approval_status, 'to', new.approval_status));
  end if;
  if new.role is distinct from old.role then
    perform public.audit('account_role', 'profile', new.id,
                         jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end;
$$;

revoke execute on function public.audit_profile() from public, anon, authenticated;

drop trigger if exists profiles_90_audit on profiles;
create trigger profiles_90_audit
  after update of approval_status, role or delete on profiles
  for each row execute function public.audit_profile();

-- --------------------------------------------------------------- companies ---

create or replace function public.audit_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.audit('company_deleted', 'company', old.id, '{}'::jsonb);
    return old;
  end if;

  if new.verification_status is distinct from old.verification_status then
    perform public.audit('company_verification', 'company', new.id,
                         jsonb_build_object('from', old.verification_status, 'to', new.verification_status));
  end if;
  return new;
end;
$$;

revoke execute on function public.audit_company() from public, anon, authenticated;

drop trigger if exists companies_90_audit on companies;
create trigger companies_90_audit
  after update of verification_status or delete on companies
  for each row execute function public.audit_company();

-- --------------------------------------------------------- company_members ---

create or replace function public.audit_company_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('member_added', 'company_member', new.company_id,
                         jsonb_build_object('user_id', new.user_id, 'role', new.role));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.audit('member_removed', 'company_member', old.company_id,
                         jsonb_build_object('user_id', old.user_id, 'role', old.role));
    return old;
  end if;

  if new.role is distinct from old.role then
    perform public.audit('member_role', 'company_member', new.company_id,
                         jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
  end if;
  return new;
end;
$$;

revoke execute on function public.audit_company_member() from public, anon, authenticated;

drop trigger if exists company_members_90_audit on company_members;
create trigger company_members_90_audit
  after insert or update of role or delete on company_members
  for each row execute function public.audit_company_member();

-- -------------------------------------------------------------------- jobs ---

-- Every status move, not only moderation: "when did this listing expire, and
-- who closed it" is the question a dispute turns on, and the row itself only
-- remembers where it is now.
create or replace function public.audit_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.audit('job_deleted', 'job', old.id,
                         jsonb_build_object('company_id', old.company_id, 'status', old.status));
    return old;
  end if;

  if new.status is distinct from old.status then
    perform public.audit('job_status', 'job', new.id,
                         jsonb_build_object('company_id', new.company_id,
                                            'from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

revoke execute on function public.audit_job() from public, anon, authenticated;

drop trigger if exists jobs_90_audit on jobs;
create trigger jobs_90_audit
  after update of status or delete on jobs
  for each row execute function public.audit_job();

-- -------------------------------------------------------- company_documents ---

create or replace function public.audit_company_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.audit('document_withdrawn', 'company_document', old.id,
                         jsonb_build_object('company_id', old.company_id, 'status', old.status,
                                            'doc_type', old.doc_type));
    return old;
  end if;

  if new.status is distinct from old.status then
    perform public.audit('document_review', 'company_document', new.id,
                         jsonb_build_object('company_id', new.company_id,
                                            'from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

revoke execute on function public.audit_company_document() from public, anon, authenticated;

drop trigger if exists company_documents_90_audit on company_documents;
create trigger company_documents_90_audit
  after update of status or delete on company_documents
  for each row execute function public.audit_company_document();

-- ---------------------------------------------------------------------------
-- An address that outlives the account it belonged to
--
-- email_log.user_id is `on delete set null`, so a deleted account's messages
-- stay in the outbox — which is right, they were sent — with the recipient
-- address still on every row, attached to nothing, retained forever. The one
-- thing the delivery record never needed after the account is gone is who it
-- was delivered to.
--
-- Redacted to a reserved .invalid address rather than blanked: `recipient` is
-- NOT NULL, and is_undeliverable_domain() already refuses .invalid, so a
-- redacted row can never be picked up by the retry sweeper and sent anywhere.
--
-- BEFORE DELETE, because by AFTER the user_id that finds the rows has been
-- nulled by the foreign key. Rows written to an address with no account behind
-- them are not reachable from here and are covered by email_log retention
-- instead (migration 69). email_suppressions is deliberately left alone: a
-- hard bounce is about the address, not the account, and forgetting it would
-- mean mailing a dead address again the day somebody re-registers it.
-- ---------------------------------------------------------------------------

create or replace function public.redact_email_log_for_deleted_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update email_log
     set recipient = 'redacted@account-deleted.invalid'
   where user_id = old.id
     and recipient <> 'redacted@account-deleted.invalid';
  return old;
end;
$$;

revoke execute on function public.redact_email_log_for_deleted_profile() from public, anon, authenticated;

drop trigger if exists profiles_80_redact_email_log on profiles;
create trigger profiles_80_redact_email_log
  before delete on profiles
  for each row execute function public.redact_email_log_for_deleted_profile();
