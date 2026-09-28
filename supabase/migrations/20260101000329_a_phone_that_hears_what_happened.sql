-- =============================================================================
-- 329 — A phone that hears what happened
--
-- The iOS app shows the same bell as the website, but a bell is only heard by
-- somebody already looking at it. An employer whose listing took an applicant
-- at ten at night, a candidate whose application was just shortlisted: the
-- email arrives, sometimes into spam, and the app said nothing. This gives
-- every notification the website writes a way to reach a phone.
--
-- Nothing about *what* is notified changes. The bell's rows are still written
-- by the triggers on the rows that changed (migrations 17, 300–302, 325–328),
-- in the transaction of the fact they report. A push is a second delivery of
-- the same row, queued here and sent by the website:
--
--   push_devices          the phones a person has signed in on, each with its
--                         Expo push token. Registered through
--                         register_push_device(), which moves a token to the
--                         caller when somebody else signs in on the same
--                         phone — a phone belongs to whoever is using it. Read
--                         by its owner; written only through the two functions.
--
--   push_outbox           one row per notification that should reach a phone,
--                         fed by an AFTER INSERT trigger on notifications for
--                         a row that is unread and not folded into another —
--                         so twenty applicants to one listing are one push, as
--                         they are one row in the bell (migration 302). Only
--                         for people with a registered phone, and it never
--                         fails the insert it rides on: a broken push is a
--                         warning, never a lost application.
--
--   lease_due_pushes()    the email outbox's shape (migration 324): due rows
--   settle_push()         taken FOR UPDATE SKIP LOCKED under a token and an
--                         expiry, settled on the same row, retried with
--                         backoff (1 minute, 5, 30, then 2 hours) and given up
--                         after five tries or eight leases. A push that could
--                         not go out within a day is not news any more.
--
--   push_tickets          what Expo answered for each phone, kept until its
--                         receipt is read (15 minutes to a day later) so a
--                         phone that no longer has the app can be switched
--                         off instead of being sent to forever.
--
-- Quiet hours. The expiry sweep runs at 01:00 UTC, which is three or four in
-- the morning in Cairo. "Your listing expires in three days" is not worth
-- waking anybody for, so the two routine kinds (job_expiring, job_expired)
-- created between 21:00 and 09:00 Cairo time wait until nine. Everything
-- about a person's applications, account or reports goes when it happens.
--
-- Sending is the website's (src/lib/push, /api/cron/push): it composes the
-- sentence the bell shows, in the phone's language, without the free-text
-- note (a rejection reason does not belong on a lock screen), and calls the
-- Expo push service. It runs right after the action that caused it (the
-- publish() path, in after()), and from a sweep every minute: scheduled here
-- with pg_cron and pg_net when the project has them and the two Vault secrets
-- are set by hand (docs/mobile.md), and from Vercel Cron as a second caller.
-- =============================================================================

-- rollback: drop trigger if exists notifications_50_push on notifications; select cron.unschedule('brokersconnect-push') where exists (select 1 from pg_extension where extname = 'pg_cron'); drop function if exists public.enqueue_push(), public.push_not_before(notification_kind, timestamptz), public.push_retry_delay(integer), public.lease_due_pushes(integer, integer), public.settle_push(bigint, uuid, text, text), public.prune_push_outbox(integer), public.register_push_device(text, text, text, text), public.unregister_push_device(text); drop table if exists push_tickets, push_outbox, push_devices;
-- safety: ships-with-code — safe in either order: until this is applied the app's registerPushDevice answers "failed" and nothing is queued; once applied, rows queue for people with a registered phone and wait until the delivering code (and EXPO_ACCESS_TOKEN) arrives, and anything a day old is skipped rather than sent late

-- ---------------------------------------------------------------------------
-- Phones
-- ---------------------------------------------------------------------------

create table if not exists public.push_devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Expo's own format: ExponentPushToken[…] (or ExpoPushToken[…]).
  token           text not null
                  check (token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{8,64}\]$'),
  platform        text not null check (platform in ('ios', 'android')),
  -- The language the phone's pushes are written in: the app's, not the profile's.
  locale          text not null default 'ar' check (locale in ('ar', 'en')),
  app_version     text check (app_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$'),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  disabled_at     timestamptz,
  disabled_reason text check (length(disabled_reason) <= 200)
);

create unique index if not exists push_devices_token_key on push_devices (token);
create index if not exists push_devices_active_idx on push_devices (user_id) where disabled_at is null;

comment on table push_devices is
  'The phones a person has signed in on with the app, each with its Expo push token. Written only by register_push_device / unregister_push_device and the push sender (migration 329).';

alter table push_devices enable row level security;

drop policy if exists push_devices_read_own on push_devices;
create policy push_devices_read_own on push_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The outbox and Expo's tickets
-- ---------------------------------------------------------------------------

create table if not exists public.push_outbox (
  id              bigint generated always as identity primary key,
  notification_id uuid not null references notifications (id) on delete cascade,
  user_id         uuid not null,
  status          text not null default 'queued'
                  check (status in ('queued', 'sent', 'skipped', 'failed')),
  attempts        smallint not null default 0,
  leases          smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until     timestamptz,
  lock_token      uuid,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  detail          text check (length(detail) <= 500)
);

create unique index if not exists push_outbox_notification_key on push_outbox (notification_id);
create index if not exists push_outbox_due_idx on push_outbox (next_attempt_at) where status = 'queued';
create index if not exists push_outbox_settled_idx on push_outbox (settled_at) where status <> 'queued';

comment on table push_outbox is
  'One row per notification to deliver to a phone; queued by notifications_50_push, leased and settled by the push sender (migration 329). Service role only.';

create table if not exists public.push_tickets (
  ticket_id  text primary key check (length(ticket_id) between 1 and 100),
  device_id  uuid not null references push_devices (id) on delete cascade,
  outbox_id  bigint references push_outbox (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists push_tickets_created_idx on push_tickets (created_at);

comment on table push_tickets is
  'Expo push tickets awaiting their receipt, so a phone that no longer has the app is switched off (migration 329). Service role only.';

-- Nobody reads or writes these through the API: no policies, and RLS on.
alter table push_outbox enable row level security;
alter table push_tickets enable row level security;

-- ---------------------------------------------------------------------------
-- When a notification may reach a phone, and how long a retry waits
-- ---------------------------------------------------------------------------

create or replace function public.push_not_before(p_kind notification_kind, p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_kind in ('job_expiring', 'job_expired')
     and extract(hour from p_at at time zone 'Africa/Cairo') not between 9 and 20
    then (date_trunc('day', p_at at time zone 'Africa/Cairo')
          + case when extract(hour from p_at at time zone 'Africa/Cairo') >= 21
                 then interval '1 day' else interval '0 days' end
          + interval '9 hours') at time zone 'Africa/Cairo'
    else p_at
  end;
$$;

create or replace function public.push_retry_delay(p_attempt integer)
returns interval
language sql
immutable
set search_path = public
as $$
  select make_interval(secs => (array[60, 300, 1800, 7200])[least(greatest(p_attempt, 1), 4)]);
$$;

-- ---------------------------------------------------------------------------
-- Queued as the notification is written
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only somebody with a phone to tell: most accounts have none, and a row
  -- queued for nobody would only be swept up and skipped.
  if exists (
    select 1 from push_devices d
     where d.user_id = new.user_id and d.disabled_at is null
  ) then
    insert into push_outbox (notification_id, user_id, next_attempt_at)
    values (new.id, new.user_id, public.push_not_before(new.kind, new.created_at))
    on conflict (notification_id) do nothing;
  end if;
  return null;
exception when others then
  -- The notification is the fact; the push is a courtesy. Never the other
  -- way round.
  raise warning 'enqueue_push(%): %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists notifications_50_push on notifications;
create trigger notifications_50_push
  after insert on notifications
  for each row
  when (new.read_at is null and new.folded_into is null)
  execute function public.enqueue_push();

-- ---------------------------------------------------------------------------
-- The sender's side: lease, settle, prune
-- ---------------------------------------------------------------------------

create or replace function public.lease_due_pushes(
  p_limit         integer default 50,
  p_lease_seconds integer default 60
)
returns table (id bigint, notification_id uuid, user_id uuid, attempts smallint, lock_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A row that has crashed its worker eight times is not going to succeed on
  -- the ninth, and one a day old is not news any more.
  update push_outbox o
     set status = 'failed', settled_at = now(), lease_until = null, lock_token = null,
         detail = case when o.leases >= 8 then 'leased too often' else 'expired' end
   where o.status = 'queued'
     and (o.lease_until is null or o.lease_until < now())
     and (o.leases >= 8 or o.created_at < now() - interval '1 day');

  return query
  with due as (
    select q.id
      from push_outbox q
     where q.status = 'queued'
       and q.next_attempt_at <= now()
       and (q.lease_until is null or q.lease_until < now())
     order by q.next_attempt_at, q.id
     limit least(greatest(coalesce(p_limit, 50), 1), 500)
       for update skip locked
  ),
  lease as (
    select gen_random_uuid() as token
  )
  update push_outbox o
     set lock_token  = lease.token,
         lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 10), 600)),
         leases      = o.leases + 1
    from due, lease
   where o.id = due.id
  returning o.id, o.notification_id, o.user_id, o.attempts, o.lock_token;
end;
$$;

/*
  sent     at least one phone accepted it
  skipped  nothing to send any more: read already, no phone left, gone
  retry    Expo did not answer as it should; again after push_retry_delay(),
           and failed after the fifth try
  failed   will not succeed however often it is tried
*/
create or replace function public.settle_push(
  p_id         bigint,
  p_lock_token uuid,
  p_outcome    text,
  p_detail     text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome is null or p_outcome not in ('sent', 'skipped', 'retry', 'failed') then
    raise exception 'settle_push: unknown outcome %', p_outcome using errcode = '22023';
  end if;

  update push_outbox o
     set attempts        = o.attempts + case when p_outcome = 'skipped' then 0 else 1 end,
         status          = case
                             when p_outcome = 'retry' and o.attempts + 1 < 5 then 'queued'
                             when p_outcome = 'retry' then 'failed'
                             else p_outcome
                           end,
         next_attempt_at = case when p_outcome = 'retry'
                                then now() + public.push_retry_delay(o.attempts + 1)
                                else o.next_attempt_at end,
         settled_at      = case when p_outcome = 'retry' and o.attempts + 1 < 5 then null else now() end,
         lease_until     = null,
         lock_token      = null,
         detail          = left(p_detail, 500)
   where o.id = p_id
     and o.lock_token = p_lock_token
     and o.status = 'queued';
  return found;
end;
$$;

/* Settled rows after 30 days, and tickets whose receipts Expo no longer keeps. Bounded, like 204's jobs. */
create or replace function public.prune_push_outbox(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
  v_tickets integer;
begin
  delete from push_outbox o
   where o.id in (
     select q.id from push_outbox q
      where q.status <> 'queued' and q.settled_at < now() - interval '30 days'
      order by q.settled_at
      limit least(greatest(coalesce(p_limit, 5000), 1), 50000)
   );
  get diagnostics v_rows = row_count;

  delete from push_tickets t
   where t.ticket_id in (
     select k.ticket_id from push_tickets k
      where k.created_at < now() - interval '2 days'
      order by k.created_at
      limit least(greatest(coalesce(p_limit, 5000), 1), 50000)
   );
  get diagnostics v_tickets = row_count;

  return v_rows + v_tickets;
end;
$$;

-- ---------------------------------------------------------------------------
-- The app's side: register this phone, forget it on sign-out
-- ---------------------------------------------------------------------------

create or replace function public.register_push_device(
  p_token       text,
  p_platform    text,
  p_locale      text default 'ar',
  p_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'register_push_device: not signed in' using errcode = '42501';
  end if;

  insert into push_devices (user_id, token, platform, locale, app_version)
  values (v_user, p_token, p_platform, coalesce(nullif(p_locale, ''), 'ar'), nullif(p_app_version, ''))
  on conflict (token) do update
     set user_id         = excluded.user_id,
         platform        = excluded.platform,
         locale          = excluded.locale,
         app_version     = excluded.app_version,
         last_seen_at    = now(),
         disabled_at     = null,
         disabled_reason = null
  returning id into v_id;

  -- Ten phones is more than anybody carries; past that, the one unseen longest stops.
  update push_devices d
     set disabled_at = now(), disabled_reason = 'too many phones'
   where d.user_id = v_user
     and d.disabled_at is null
     and d.id not in (
       select k.id from push_devices k
        where k.user_id = v_user and k.disabled_at is null
        order by k.last_seen_at desc
        limit 10
     );

  return v_id;
end;
$$;

create or replace function public.unregister_push_device(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_devices where token = p_token and user_id = auth.uid();
$$;

-- Default privileges grant EXECUTE to everyone (setup, and Supabase); these
-- are the sender's and the trigger's, and two for a signed-in app.
revoke execute on function public.enqueue_push() from public, anon, authenticated;
revoke execute on function public.lease_due_pushes(integer, integer) from public, anon, authenticated;
revoke execute on function public.settle_push(bigint, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.prune_push_outbox(integer) from public, anon, authenticated;
grant execute on function public.lease_due_pushes(integer, integer) to service_role;
grant execute on function public.settle_push(bigint, uuid, text, text) to service_role;
grant execute on function public.prune_push_outbox(integer) to service_role;

revoke execute on function public.register_push_device(text, text, text, text) from public, anon;
revoke execute on function public.unregister_push_device(text) from public, anon;
grant execute on function public.register_push_device(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;

-- ---------------------------------------------------------------------------
-- A sweep every minute, from inside the database
--
-- Conditional, like migration 204's: on a Postgres without pg_cron and pg_net
-- (the test harness) this does nothing. On Supabase it asks the website to
-- run /api/cron/push once a minute — but only when something is due, so an
-- idle minute costs one indexed query and no request. The address and the
-- cron secret are read from Vault at run time; neither is in this public
-- repository, and until both are set by hand the job does nothing:
--
--   select vault.create_secret('https://www.brokersconnect.net/api/cron/push', 'push_sweep_url');
--   select vault.create_secret('<CRON_SECRET>', 'push_sweep_secret');
--
-- cron.schedule with a name replaces a job of that name.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule(
      'brokersconnect-push',
      '* * * * *',
      $job$
        select net.http_get(
                 url     := (select decrypted_secret from vault.decrypted_secrets where name = 'push_sweep_url'),
                 headers := jsonb_build_object(
                   'authorization',
                   'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_sweep_secret')
                 )
               )
         where exists (select 1 from vault.decrypted_secrets where name = 'push_sweep_url')
           and exists (select 1 from vault.decrypted_secrets where name = 'push_sweep_secret')
           and exists (select 1 from public.push_outbox
                        where status = 'queued' and next_attempt_at <= now())
      $job$
    );
  end if;
end;
$$;
