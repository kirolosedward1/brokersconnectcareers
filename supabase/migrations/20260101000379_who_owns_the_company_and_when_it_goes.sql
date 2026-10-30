-- =============================================================================
-- 379 — Who owns the company, and when it goes
--
-- docs/design/v1.1/phase-b/07, part 7c, and the company closure question in
-- docs/data-lifecycle.md ("Today both are refused"). Decided:
--
--   * Ownership moves only to somebody already on the team.
--   * The owner may close the company. It is hidden at once, and goes after
--     14 days unless the owner changes their mind.
--   * A company may have the applications to its closed listings purged after
--     a period it chooses.
--   * A candidate keeps a record of an application a company purged or took
--     with it: the listing's title, the company's name, when they applied and
--     how it stood. Not the CV, not the note, not the company's notes.
--
-- What stays refused: a company that has ever been paid for is not deleted
-- (orders.company_id restricts, migration 353 — a payment is the platform's
-- record). On its 14th day such a company is closed instead: its
-- applications and listings go as they would, everyone but the owner is
-- taken off the team, its profile is emptied, and the row stays with its
-- name for the orders.
--
--   transfer_company_ownership(p_to)   the owner hands over to a member, who
--                                      becomes an admin with every switch on;
--                                      the former owner stays an admin.
--   request_company_deletion()         the owner asks; listings close (live)
--                                      or go back to draft (in review),
--                                      hiring pauses, company_suspended()
--                                      answers true so the public page hides it.
--   cancel_company_deletion()          the owner changes their mind; listings
--                                      stay closed and hiring paused, to be
--                                      reopened on purpose.
--   companies.purge_closed_after_days  30, 90, 180 or 365; null keeps them
--                                      (and the yearly retention still runs).
--   close_due_companies()              nightly: purges, closes, deletes.
--
-- Tested in supabase/tests/company-closure.test.mjs.
--
-- rollback: select cron.unschedule('brokersconnect-company-closure') (where pg_cron exists);
--           drop trigger if exists jobs_04_company_closing on jobs; drop trigger if exists jobs_06_stamp_ended on jobs;
--           drop function if exists public.stamp_job_ended(); alter table jobs drop column ended_at;
--           drop function if exists public.close_due_companies(int), public.refuse_listing_while_closing(),
--             public.request_company_deletion(), public.cancel_company_deletion(),
--             public.transfer_company_ownership(uuid), public.record_purged_applications(uuid[], text);
--           restate company_suspended() from migration 367 and guard_company_update() from migration 368;
--           drop table if exists application_records;
--           alter table companies drop column deletion_requested_at, drop column closed_at, drop column purge_closed_after_days;
--           restate company_activity's kind check from migration 377.
-- safety: additive — nothing changes for a company until its owner asks. jobs_40_bump_version
--         is off only for the one backfill statement, inside this file's transaction.
-- safety: ships-with-code — the restated guard and company_suspended() answer as before until an
--   owner uses the new functions, which only new code calls; jobs.ended_at is stamped by trigger.
-- safety: drop — jobs_40_bump_version is off for the one backfill statement only, inside this
--   file's transaction, as migrations 347 and 365 do; no other session sees it off.
-- safety: constraint — company_activity is migration 377's, in this same branch; its rows hold only
--   the kinds both checks allow, and the new check only adds three.
-- =============================================================================

alter table companies
  add column if not exists deletion_requested_at   timestamptz,
  add column if not exists closed_at               timestamptz,
  add column if not exists purge_closed_after_days int check (purge_closed_after_days in (30, 90, 180, 365));

-- When a listing ended: nothing recorded it, and a company's purge period
-- counts from it. Stamped by the trigger below whatever an update says;
-- listings that ended before this migration count from their end date, or today.
alter table jobs add column if not exists ended_at timestamptz;
-- The platform's own stamp, not an edit: the version stays, so an open
-- appeal still reads as about the same listing (as migrations 347 and 365 do).
alter table jobs disable trigger jobs_40_bump_version;
update jobs set ended_at = least(coalesce(expires_at, now()), now())
 where status in ('closed', 'expired', 'rejected') and ended_at is null;
alter table jobs enable trigger jobs_40_bump_version;

create or replace function public.stamp_job_ended()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status in ('closed', 'expired', 'rejected') then
    new.ended_at := case when old.status in ('closed', 'expired', 'rejected') then coalesce(old.ended_at, now()) else now() end;
  else
    new.ended_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_job_ended() from public, anon, authenticated;

drop trigger if exists jobs_06_stamp_ended on jobs;
create trigger jobs_06_stamp_ended
  before update of status, ended_at on jobs
  for each row execute function public.stamp_job_ended();

comment on column companies.deletion_requested_at is
  'The owner asked for the company to be deleted. Hidden at once; deleted (or, with orders, closed) 14 days later by close_due_companies() unless cancelled.';
comment on column companies.closed_at is
  'A company that had orders, closed rather than deleted on its 14th day: no team, no listings, no profile; the row kept for the orders.';

-- ---------------------------------------------------------------------------
-- The candidate's record
-- ---------------------------------------------------------------------------

create table if not exists application_records (
  id              bigint generated always as identity primary key,
  candidate_id    uuid not null references profiles(id) on delete cascade,
  job_title_ar    text not null,
  job_title_en    text,
  company_name_ar text not null,
  company_name_en text,
  applied_at      timestamptz not null,
  last_status     application_status not null,
  ended_at        timestamptz not null default now(),
  -- 'company_deleted': the company closed. 'company_purged': it cleared its closed listings' applications.
  reason          text not null check (reason in ('company_deleted', 'company_purged'))
);

create index if not exists application_records_candidate_idx on application_records (candidate_id, applied_at desc);

alter table application_records enable row level security;
revoke all on application_records from anon;
grant select on application_records to authenticated;

create policy application_records_own on application_records
  for select to authenticated using (candidate_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The log learns two more things
-- ---------------------------------------------------------------------------

alter table company_activity drop constraint if exists company_activity_kind_check;
alter table company_activity add constraint company_activity_kind_check check (kind in (
  'application_moved', 'note_added', 'interview_invited',
  'contact_revealed', 'job_created', 'job_status',
  'member_added', 'member_removed', 'member_changed', 'order_paid',
  'owner_changed', 'deletion_requested', 'deletion_cancelled'));

-- ---------------------------------------------------------------------------
-- The owner's row may move, only through the transfer
-- ---------------------------------------------------------------------------

create or replace function public.guard_company_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_test is distinct from old.is_test
     and coalesce(current_setting('app.admin_console', true), 'off') <> 'on'
     and nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'is_test is an admin action';
  end if;

  if public.acting_as_admin() then return new; end if;

  if new.slug is distinct from old.slug then
    raise exception 'a company slug is permanent — links and follows point at it';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if not (
      coalesce(current_setting('app.submitting_for_review', true), 'off') = 'on'
      and new.verification_status = 'pending'
      and old.verification_status in ('unverified', 'rejected')
    ) then
      raise exception 'verification_status is set by review, not by the owner';
    end if;
  end if;

  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by review, not by the owner';
  end if;
  -- Migration 379: only transfer_company_ownership() moves it, to a member.
  if new.owner_id is distinct from old.owner_id
     and coalesce(current_setting('app.transferring_ownership', true), 'off') <> 'on' then
    raise exception 'company ownership moves only through transfer_company_ownership()';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not owner-writable';
  end if;

  if new.post_credits is distinct from old.post_credits
     and coalesce(current_setting('app.granting_credits', true), 'off') <> 'on' then
    raise exception 'post_credits is set by billing, not by the owner';
  end if;

  -- Migration 379: asked for and cancelled through the functions below, which say so in the log.
  if (new.deletion_requested_at is distinct from old.deletion_requested_at
      or new.closed_at is distinct from old.closed_at)
     and coalesce(current_setting('app.company_closure', true), 'off') <> 'on' then
    raise exception 'a company is closed through request_company_deletion()';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hidden while it goes
-- ---------------------------------------------------------------------------

create or replace function public.company_suspended(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Suspended by an admin, or on its way out (migration 379): either way not on the public site.
  select exists (
    select 1 from public.companies
     where id = p_id
       and (suspended_at is not null or deletion_requested_at is not null or closed_at is not null)
  );
$$;

-- Nothing goes up for review while the company is closing.
create or replace function public.refuse_listing_while_closing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('pending_review', 'active')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and exists (select 1 from companies where id = new.company_id
                  and (deletion_requested_at is not null or closed_at is not null)) then
    raise exception 'company_closing'
      using hint = 'The company is being deleted; cancel that first.';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_listing_while_closing() from public, anon, authenticated;

drop trigger if exists jobs_04_company_closing on jobs;
create trigger jobs_04_company_closing
  before insert or update of status on jobs
  for each row execute function public.refuse_listing_while_closing();

-- ---------------------------------------------------------------------------
-- Handing over
-- ---------------------------------------------------------------------------

create or replace function public.transfer_company_ownership(p_to uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.my_company_id();
  v_row companies%rowtype;
begin
  if v_company is null then
    return 'not_owner';
  end if;
  select * into v_row from companies where id = v_company for update;
  if auth.uid() is distinct from v_row.owner_id then
    return 'not_owner';
  end if;
  if v_row.deletion_requested_at is not null then
    return 'closing';
  end if;
  if p_to = auth.uid()
     or not exists (select 1 from company_members where company_id = v_company and user_id = p_to) then
    return 'not_member';
  end if;
  -- An employer account in good standing: a suspended colleague cannot own it.
  if not exists (select 1 from profiles where id = p_to and role = 'employer' and approval_status <> 'rejected') then
    return 'not_eligible';
  end if;

  perform set_config('app.transferring_ownership', 'on', true);
  update companies set owner_id = p_to where id = v_company;
  perform set_config('app.transferring_ownership', 'off', true);

  update company_members
     set role = 'admin', can_post = true, can_reveal = true, can_spend = true
   where company_id = v_company and user_id = p_to;

  perform public.record_company_activity(v_company, 'owner_changed', null, null, p_to, null, '{}'::jsonb);
  return 'ok';
end;
$$;

revoke execute on function public.transfer_company_ownership(uuid) from public, anon;
grant execute on function public.transfer_company_ownership(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Closing
-- ---------------------------------------------------------------------------

create or replace function public.request_company_deletion()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.my_company_id();
  v_row companies%rowtype;
begin
  if v_company is null then
    return 'not_owner';
  end if;
  select * into v_row from companies where id = v_company for update;
  if auth.uid() is distinct from v_row.owner_id then
    return 'not_owner';
  end if;
  if v_row.deletion_requested_at is not null then
    return 'ok';
  end if;

  perform set_config('app.company_closure', 'on', true);
  update companies
     set deletion_requested_at = now(), hiring_status = 'paused', paused_until = null
   where id = v_company;
  perform set_config('app.company_closure', 'off', true);

  -- Off the board at once: a live listing closes, one in review goes back to draft.
  update jobs set status = 'closed' where company_id = v_company and status = 'active';
  update jobs set status = 'draft' where company_id = v_company and status = 'pending_review';

  perform public.record_company_activity(v_company, 'deletion_requested', null, null, null, null, '{}'::jsonb);
  return 'ok';
end;
$$;

revoke execute on function public.request_company_deletion() from public, anon;
grant execute on function public.request_company_deletion() to authenticated, service_role;

create or replace function public.cancel_company_deletion()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := public.my_company_id();
  v_row companies%rowtype;
begin
  if v_company is null then
    return 'not_owner';
  end if;
  select * into v_row from companies where id = v_company for update;
  if auth.uid() is distinct from v_row.owner_id then
    return 'not_owner';
  end if;
  if v_row.deletion_requested_at is null then
    return 'ok';
  end if;

  perform set_config('app.company_closure', 'on', true);
  update companies set deletion_requested_at = null where id = v_company;
  perform set_config('app.company_closure', 'off', true);

  perform public.record_company_activity(v_company, 'deletion_cancelled', null, null, null, null, '{}'::jsonb);
  return 'ok';
end;
$$;

revoke execute on function public.cancel_company_deletion() from public, anon;
grant execute on function public.cancel_company_deletion() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The nightly work
-- ---------------------------------------------------------------------------

-- Writes each candidate's record, then deletes the applications: their
-- events, notes and invitations go with them (cascades), the withdrawal
-- notice does not fire (app.retention_purge), and an uploaded CV is queued
-- for removal by the existing release trigger.
create or replace function public.record_purged_applications(p_ids uuid[], p_reason text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  insert into application_records (candidate_id, job_title_ar, job_title_en, company_name_ar, company_name_en, applied_at, last_status, reason)
  select a.candidate_id, j.title_ar, j.title_en, c.name_ar, c.name_en, a.created_at, a.status, p_reason
    from applications a
    join jobs j on j.id = a.job_id
    join companies c on c.id = j.company_id
   where a.id = any(p_ids);

  perform set_config('app.retention_purge', 'on', true);
  delete from applications where id = any(p_ids);
  get diagnostics n = row_count;
  perform set_config('app.retention_purge', 'off', true);
  return n;
end;
$$;

revoke execute on function public.record_purged_applications(uuid[], text) from public, anon, authenticated;

create or replace function public.close_due_companies(p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company record;
  v_ids uuid[];
  v_purged int := 0;
  v_deleted int := 0;
  v_closed int := 0;
  v_errors text[] := '{}';
begin
  if not pg_try_advisory_xact_lock(hashtext('brokersconnect-company-closure')) then
    return jsonb_build_object('skipped', true);
  end if;

  -- A company's own choice: applications to listings closed longer than it said.
  for v_company in
    select id, purge_closed_after_days from companies
     where purge_closed_after_days is not null and deletion_requested_at is null and closed_at is null
  loop
    begin
      select array_agg(a.id) into v_ids
        from applications a
        join jobs j on j.id = a.job_id
       where j.company_id = v_company.id
         -- Ended: closed, rejected or expired by the cron (ended_at), or past its end date before the cron ran.
         and coalesce(j.ended_at, case when j.expires_at < now() then j.expires_at end)
             < now() - make_interval(days => v_company.purge_closed_after_days);
      if v_ids is not null then
        v_purged := v_purged + public.record_purged_applications(v_ids, 'company_purged');
      end if;
    exception when others then
      v_errors := v_errors || (v_company.id::text || ': ' || sqlerrm);
    end;
  end loop;

  -- The 14th day.
  for v_company in
    select id from companies
     where deletion_requested_at < now() - interval '14 days' and closed_at is null
     order by deletion_requested_at
     limit p_limit
     for update skip locked
  loop
    begin
      select array_agg(a.id) into v_ids
        from applications a join jobs j on j.id = a.job_id
       where j.company_id = v_company.id;
      if v_ids is not null then
        perform public.record_purged_applications(v_ids, 'company_deleted');
      end if;

      if exists (select 1 from orders where company_id = v_company.id) then
        -- Paid for once: the row stays for the orders, emptied.
        delete from jobs where company_id = v_company.id;
        -- The owner stays on it (an owner is never off their own company,
        -- guard_company_membership): it is theirs to see closed, and support's to settle.
        delete from company_members m using companies c
         where m.company_id = v_company.id and c.id = m.company_id and m.user_id <> c.owner_id;
        perform set_config('app.company_closure', 'on', true);
        update companies
           set closed_at = now(), about_ar = null, about_en = null, logo_url = null, website = null,
               contact_whatsapp = null, reply_hours = null
         where id = v_company.id;
        perform set_config('app.company_closure', 'off', true);
        v_closed := v_closed + 1;
      else
        delete from companies where id = v_company.id;
        v_deleted := v_deleted + 1;
      end if;
    exception when others then
      v_errors := v_errors || (v_company.id::text || ': ' || sqlerrm);
    end;
  end loop;

  -- A record is kept as long as the application would have been: a year from applying (migration 338).
  delete from application_records where applied_at < now() - interval '365 days';

  return jsonb_build_object('purged', v_purged, 'deleted', v_deleted, 'closed', v_closed, 'errors', to_jsonb(v_errors));
end;
$$;

revoke execute on function public.close_due_companies(int) from public, anon, authenticated;
grant execute on function public.close_due_companies(int) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'brokersconnect-company-closure',
      '17 4 * * *',
      'select public.close_due_companies()'
    );
  end if;
end;
$$;
