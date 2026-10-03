-- =============================================================================
-- 335 — A phone that hears what you asked for
--
-- Pushes were one switch per phone: everything the bell holds, or nothing. A
-- candidate who wanted to hear about their applications but not about every
-- new listing, or an employer who wanted new applicants but not listing
-- reminders, had to choose all or none. Now each person chooses three kinds
-- (the app's notification settings, /account/alerts), for all their phones:
--
--   push_job_alerts     the day's new listings (new_jobs, migration 334)
--   push_applications   an application sent, received, withdrawn or moved
--   push_account        everything else: approvals, listings published,
--                       rejected or ending, verification, moderation
--                       decisions, support replies, a password changed
--
-- and may keep quiet hours: what comes between 23:00 and 08:00 Cairo time
-- waits until eight. Off unless turned on — in Cairo the evening runs late,
-- and a reply at eleven is not a push anybody asked to have held — and the
-- expiry notices keep their own daytime window (migration 329) either way.
--
-- A kind turned off still reaches the bell, and email where the person gets
-- email: only the phone stays quiet about it. Enforced where pushes are
-- queued (enqueue_push), so no sender can get it wrong.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: restate enqueue_push() from migration 329; drop function public.push_hold_until(notification_kind, timestamptz, boolean), public.push_category(notification_kind); alter table profiles drop column push_job_alerts, drop column push_applications, drop column push_account, drop column push_quiet_hours;
-- safety: ships-with-code — the defaults are today's behaviour (every kind pushed, nothing held), so applying this first changes nothing; the code first, the app shows no settings until these columns exist, and the website's save refuses the unknown columns so a switch puts itself back

alter table profiles
  add column if not exists push_job_alerts   boolean not null default true,
  add column if not exists push_applications boolean not null default true,
  add column if not exists push_account      boolean not null default true,
  add column if not exists push_quiet_hours  boolean not null default false;

comment on column profiles.push_job_alerts is 'Pushes for the day''s new listings (new_jobs). The bell has them either way.';
comment on column profiles.push_applications is 'Pushes for applications sent, received, withdrawn or moved. The bell has them either way.';
comment on column profiles.push_account is 'Pushes for every other kind. The bell has them either way.';
comment on column profiles.push_quiet_hours is 'Hold pushes made between 23:00 and 08:00 Cairo time until eight.';

-- ---------------------------------------------------------------------------
-- Which switch a kind answers to
-- ---------------------------------------------------------------------------

create or replace function public.push_category(p_kind notification_kind)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind = 'new_jobs' then 'job_alerts'
    when p_kind in ('application_submitted', 'application_received', 'application_withdrawn', 'application_moved')
      then 'applications'
    else 'account'
  end;
$$;

-- ---------------------------------------------------------------------------
-- When a push may go
-- ---------------------------------------------------------------------------

-- The expiry notices wait for the day as before (push_not_before, migration
-- 329); anything else, for somebody keeping quiet hours, waits out the night.
-- Cairo's wall clock, so the hold moves with daylight saving.
create or replace function public.push_hold_until(p_kind notification_kind, p_at timestamptz, p_quiet boolean)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_kind in ('job_expiring', 'job_expired') then public.push_not_before(p_kind, p_at)
    when coalesce(p_quiet, false)
     and (extract(hour from p_at at time zone 'Africa/Cairo') >= 23
          or extract(hour from p_at at time zone 'Africa/Cairo') < 8)
    then (date_trunc('day', p_at at time zone 'Africa/Cairo')
          + case when extract(hour from p_at at time zone 'Africa/Cairo') >= 23
                 then interval '1 day' else interval '0 days' end
          + interval '8 hours') at time zone 'Africa/Cairo'
    else p_at
  end;
$$;

-- ---------------------------------------------------------------------------
-- Queued as the person chose
-- ---------------------------------------------------------------------------

-- Migration 329's, with the person's choices: a kind they turned off is not
-- queued, and the rest wait for their quiet hours. Somebody without a profile
-- row gets the defaults.
create or replace function public.enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_alerts   boolean;
  v_applications boolean;
  v_account      boolean;
  v_quiet        boolean;
begin
  -- Only somebody with a phone to tell: most accounts have none, and a row
  -- queued for nobody would only be swept up and skipped.
  if not exists (
    select 1 from push_devices d
     where d.user_id = new.user_id and d.disabled_at is null
  ) then
    return null;
  end if;

  select p.push_job_alerts, p.push_applications, p.push_account, p.push_quiet_hours
    into v_job_alerts, v_applications, v_account, v_quiet
    from profiles p
   where p.id = new.user_id;

  if not coalesce(
    case public.push_category(new.kind)
      when 'job_alerts' then v_job_alerts
      when 'applications' then v_applications
      else v_account
    end,
    true
  ) then
    return null;
  end if;

  insert into push_outbox (notification_id, user_id, next_attempt_at)
  values (new.id, new.user_id, public.push_hold_until(new.kind, new.created_at, v_quiet))
  on conflict (notification_id) do nothing;
  return null;
exception when others then
  -- The notification is the fact; the push is a courtesy. Never the other
  -- way round.
  raise warning 'enqueue_push(%): %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.enqueue_push() from public, anon, authenticated;
revoke all on function public.push_hold_until(notification_kind, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.push_category(notification_kind) from public, anon, authenticated;
