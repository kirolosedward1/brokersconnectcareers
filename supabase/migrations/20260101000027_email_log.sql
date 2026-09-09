-- =============================================================================
-- 27 — The email outbox
--
-- Until now sending was fire-and-forget: compose, POST to Resend, log a line
-- to stdout, forget. That is fine right up to the first "الإيميل موصلنيش",
-- at which point nobody can answer whether the message was composed, whether
-- Resend accepted it, or whether it bounced — and the only recovery for a
-- provider outage is that the message is gone.
--
-- This is an outbox, not a log. The row is written *before* the send and is
-- what makes the other three requirements possible at all:
--
--   idempotency — `dedupe_key` is unique, so the second attempt to tell an
--                 employer about application X loses the insert and returns
--                 rather than sending. A webhook retry, a double-submitted
--                 form and a re-run cron all collapse into one message.
--
--   retries     — a row still `queued` or `failed` after the request has gone
--                 is work the sweeper picks up. Bounded by `attempts`, so a
--                 permanently bad address stops rather than looping forever.
--
--   truth       — `sent` means Resend accepted it. `delivered` means Resend's
--                 webhook said the receiving server took it. They are separate
--                 columns because they are separate claims, and reporting the
--                 first as the second is how delivery dashboards start lying.
--
-- No message body is stored. The support question is "did it go and what
-- happened to it", which the metadata answers; keeping a copy of every status
-- change ever mailed to a candidate would be a second, unguarded copy of the
-- pipeline, retained forever, for no additional answer.
-- =============================================================================

create type email_status as enum (
  'queued',      -- written, not yet accepted by the provider
  'sent',        -- provider accepted it (this is NOT delivery)
  'delivered',   -- provider's webhook says the receiving server took it
  'bounced',     -- rejected by the receiving server
  'complained',  -- recipient marked it as spam
  'failed',      -- provider refused it, or the request never completed
  'suppressed'   -- not attempted: address is on the suppression list
);

create table email_log (
  id           uuid primary key default gen_random_uuid(),

  -- What makes two sends "the same send". Null is allowed: a message with no
  -- natural key (an ad-hoc admin notice) is simply not deduplicated, rather
  -- than being forced to invent one.
  dedupe_key   text unique,

  template     text not null,
  recipient    text not null,
  user_id      uuid references profiles on delete set null,

  -- What the message was about, so the admin view can answer "show me
  -- everything we sent about this application".
  entity_type  text,
  entity_id    uuid,

  status       email_status not null default 'queued',
  attempts     smallint not null default 0,
  provider_id  text,
  error        text,

  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  delivered_at timestamptz
);

-- The sweeper's query: unfinished work, oldest first, attempts not exhausted.
create index email_log_pending_idx on email_log (created_at)
  where status in ('queued', 'failed');

-- The admin view's queries.
create index email_log_recent_idx on email_log (created_at desc);
create index email_log_entity_idx on email_log (entity_type, entity_id);
-- The webhook arrives knowing only the provider's own id.
create index email_log_provider_idx on email_log (provider_id) where provider_id is not null;

alter table email_log enable row level security;

-- Nobody reads this with a user session. The service role bypasses RLS; admins
-- reach it through email_activity() below, which is SECURITY DEFINER and
-- checks. No policy is created on purpose: an empty policy set with RLS on is
-- a table that denies everyone, which is the correct default for a table
-- holding every user's email address.

-- ---------------------------------------------------------------------------
-- Suppression
--
-- A hard bounce means the address does not exist. Continuing to send to it is
-- how a sender's reputation is destroyed, and reputation is shared across
-- every message the domain sends — so one dead address in a digest can push
-- password resets into spam for everybody.
--
-- Soft bounces are deliberately not suppressed: "mailbox full" is temporary
-- and the retry budget in email_log already bounds those.
-- ---------------------------------------------------------------------------

create table email_suppressions (
  email      text primary key,
  reason     text not null check (reason in ('hard_bounce', 'complaint')),
  created_at timestamptz not null default now()
);

alter table email_suppressions enable row level security;

-- ---------------------------------------------------------------------------
-- Claiming a send
--
-- One statement, so two concurrent attempts cannot both decide they are first.
-- Returns the row id when the caller should send, and null when it should not:
-- either somebody already claimed this key, or the address is suppressed.
--
-- `on conflict do nothing` is the whole idempotency mechanism. The unique
-- index is the lock, held by the database rather than by a flag some caller
-- has to remember to check.
-- ---------------------------------------------------------------------------

create or replace function public.claim_email(
  p_dedupe_key  text,
  p_template    text,
  p_recipient   text,
  p_user_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from email_suppressions where email = lower(p_recipient)) then
    insert into email_log (dedupe_key, template, recipient, user_id, entity_type, entity_id, status, error)
    values (p_dedupe_key, p_template, p_recipient, p_user_id, p_entity_type, p_entity_id,
            'suppressed', 'address is suppressed')
    on conflict (dedupe_key) do nothing;
    return null;
  end if;

  insert into email_log (dedupe_key, template, recipient, user_id, entity_type, entity_id)
  values (p_dedupe_key, p_template, p_recipient, p_user_id, p_entity_type, p_entity_id)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_email(text, text, text, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the admin screen reads.
--
-- SECURITY DEFINER with an explicit admin check, rather than an RLS policy,
-- so the table itself stays closed and there is exactly one way in.
-- ---------------------------------------------------------------------------

create or replace function public.email_activity(
  p_limit  integer default 100,
  p_status email_status default null
)
returns table (
  id           uuid,
  template     text,
  recipient    text,
  status       email_status,
  attempts     smallint,
  entity_type  text,
  entity_id    uuid,
  error        text,
  created_at   timestamptz,
  sent_at      timestamptz,
  delivered_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.template, e.recipient, e.status, e.attempts, e.entity_type,
         e.entity_id, e.error, e.created_at, e.sent_at, e.delivered_at
    from email_log e
   where public.is_admin()
     and (p_status is null or e.status = p_status)
   order by e.created_at desc
   limit least(greatest(p_limit, 1), 500);
$$;

-- Revoke before grant. A new function carries EXECUTE for PUBLIC, and
-- granting to `authenticated` does not take that away — without this the
-- reader is reachable at /rest/v1/rpc/ with nothing but the anon key. It
-- answers zero rows to a non-admin, because is_admin() is in the where
-- clause, but an endpoint that exists and is guarded is worse than one that
-- does not exist.
revoke all on function public.email_activity(integer, email_status) from public, anon;
grant execute on function public.email_activity(integer, email_status) to authenticated;

-- Counts for the same screen, so the page does not pull 500 rows to say "12
-- failed".
create or replace function public.email_activity_summary()
returns table (status email_status, count bigint)
language sql
security definer
set search_path = public
as $$
  select e.status, count(*)
    from email_log e
   where public.is_admin()
     and e.created_at > now() - interval '30 days'
   group by e.status;
$$;

revoke all on function public.email_activity_summary() from public, anon;
grant execute on function public.email_activity_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Recording an attempt
--
-- In SQL because the sweeper and a live request can hold the same row, and
-- `attempts = attempts + 1` read in JavaScript is two statements with a gap in
-- the middle. `p_exhaust` spends the whole budget at once, which is how a
-- permanent failure — a malformed address, a refused domain — stops being
-- retried without the sweeper needing to understand provider error codes.
-- ---------------------------------------------------------------------------

create or replace function public.record_email_attempt(
  p_id          uuid,
  p_status      email_status,
  p_provider_id text default null,
  p_error       text default null,
  p_exhaust     boolean default false
)
returns void
language sql
security definer
set search_path = public
as $$
  update email_log
     set status      = p_status,
         attempts    = case when p_exhaust then 99 else attempts + 1 end,
         provider_id = coalesce(p_provider_id, provider_id),
         error       = p_error,
         sent_at     = case when p_status = 'sent' then now() else sent_at end
   where id = p_id;
$$;

revoke all on function public.record_email_attempt(uuid, email_status, text, text, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the sweeper picks up.
--
-- Unfinished, not exhausted, and old enough that the request which created it
-- has certainly finished — a row claimed two seconds ago is probably mid-send
-- in an after() callback, and re-sending it would defeat the whole point of
-- the claim.
-- ---------------------------------------------------------------------------

create or replace function public.pending_emails(p_limit integer default 25)
returns table (id uuid, template text, entity_id uuid, attempts smallint)
language sql
security definer
set search_path = public
as $$
  select e.id, e.template, e.entity_id, e.attempts
    from email_log e
   where e.status in ('queued', 'failed')
     and e.attempts < 3
     and e.created_at < now() - interval '5 minutes'
     and e.created_at > now() - interval '3 days'
   order by e.created_at
   limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.pending_emails(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the provider's webhook writes.
--
-- Keyed on the provider's own id, because that is the only handle a delivery
-- callback carries. Returns the number of rows it touched so the webhook can
-- tell a real event from one about a message this system never sent — which is
-- what an unsigned or replayed payload looks like.
--
-- `delivered` is only ever written here. Nothing in the send path may claim it:
-- the provider accepting a message and a mail server accepting a message are
-- different facts, and reporting the first as the second is how a delivery
-- dashboard starts lying.
-- ---------------------------------------------------------------------------

create or replace function public.mark_email_delivered(
  p_provider_id text,
  p_status      email_status
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update email_log
     set status       = p_status,
         delivered_at = case when p_status = 'delivered' then now() else delivered_at end
   where provider_id = p_provider_id
     -- A late 'delivered' must not overwrite a bounce that arrived first.
     and (p_status <> 'delivered' or status <> 'bounced');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_email_delivered(text, email_status) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Releasing a claim, so a retry can take it.
--
-- The sweeper retries by re-running the function that composed the message,
-- which claims a fresh row under the same dedupe key — and the unique index
-- refuses it. So the failed row gives up its key first.
--
-- Cleared, not deleted. The failed attempt is a record of something that
-- happened, and an outbox that erases its own failures answers "did it go"
-- with silence. `attempts` is also spent, so the released row can never be
-- picked up a second time: the new row carries the retry from here.
-- ---------------------------------------------------------------------------

create or replace function public.release_email_claim(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update email_log
     set dedupe_key = null,
         attempts   = 99,
         error      = coalesce(error, '') || ' (released for retry)'
   where id = p_id;
$$;

revoke all on function public.release_email_claim(uuid) from public, anon, authenticated;
