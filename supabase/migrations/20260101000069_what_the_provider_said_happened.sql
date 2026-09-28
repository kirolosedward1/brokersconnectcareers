-- =============================================================================
-- 69 — What the provider said happened, and who that is allowed to silence
--
-- Renumbered from 68, which the search migration merged under the same day.
-- Two files with one version cannot both be recorded (the ledger's version is
-- its primary key) and the schema suite refused the pair, which stopped every
-- database suite behind it. This one was the later of the two, and no
-- database had applied it: production's ledger carries neither 068 as of
-- 2026-09-28. The application order is unchanged — search still runs first.
--
-- The delivery webhook existed and had never recorded anything. Production ran
-- without RESEND_WEBHOOK_SECRET, the endpoint answered every callback 503 as
-- designed, and Resend disabled the webhook after a week of refusals. Setting
-- the secret brings it back; this migration is what it finds when it returns.
-- Five things about the old handling were wrong, and all five were silent:
--
--   1. Order. mark_email_delivered protected a bounce from a late delivery and
--      nothing else. A `delivery_delayed` arriving after `delivered` wrote
--      `sent` back over it, and a `delivered` arriving after a complaint wrote
--      over the complaint. Providers make no ordering promise, so the row now
--      only ever moves forward: queued < sent < failed/delivered <
--      bounced/suppressed < complained.
--
--   2. Duplicates. A provider that did not hear our 200 resends the same event.
--      Harmless while every write was idempotent, and not once soft bounces are
--      counted — so each event id is recorded, and a second arrival is a no-op.
--
--   3. Whose mail it was. The Resend account is shared with another site, and
--      its events arrive on this endpoint too. The old handler suppressed the
--      address in the payload whether or not this platform had ever written to
--      it, so a complaint about somebody else's mail silenced a BrokersConnect
--      password notice. Suppression now follows only from an event that matches
--      a row in our own outbox, and uses the recipient we recorded.
--
--   4. Soft bounces. "Mailbox full" was either ignored or, if it arrived as
--      `email.bounced`, treated as a dead address forever. Now a soft bounce is
--      a bounce for that message, and three in thirty days is what suppresses
--      the address — the "repeatedly invalid" case, without punishing a
--      single full inbox.
--
--   5. Severity. A spam complaint suppressed everything, including the one
--      message a person most needs when somebody else is in their account.
--      Complaints now stop optional and ordinary transactional mail; security
--      notices still go. An address that does not exist stops everything,
--      because there is nobody there to protect.
--
-- Plus two limits that were missing:
--
--   - A per-recipient ceiling, so no bug, loop or abused trigger can turn this
--     platform into a firehose at one inbox. Security mail is exempt.
--   - A general-purpose counter for user-triggered actions that leave no row
--     of their own to count (migration 19 explains why reports and
--     applications count themselves).
-- =============================================================================

-- ------------------------------------------------------------ suppression ---

alter table email_suppressions
  drop constraint if exists email_suppressions_reason_check;

alter table email_suppressions
  add constraint email_suppressions_reason_check
  check (reason in ('hard_bounce', 'complaint', 'provider', 'repeated_soft_bounce'));

comment on column email_suppressions.reason is
  'hard_bounce, provider and repeated_soft_bounce stop every message. complaint '
  'stops everything except security notices (claim_email p_essential).';

-- ------------------------------------------------------------ event ledger ---

create table email_webhook_events (
  -- svix-id: the provider's id for the delivery of this event, stable across
  -- its own retries. That stability is the whole dedupe mechanism.
  event_id    text primary key,
  kind        text not null check (kind in (
                'delivered', 'bounced_hard', 'bounced_soft', 'complained',
                'failed', 'suppressed', 'delayed')),
  provider_id text not null,
  -- Only set when the event matched our outbox; an event about another site's
  -- mail keeps no address here.
  recipient   text,
  received_at timestamptz not null default now()
);

create index email_webhook_events_soft_idx
  on email_webhook_events (recipient, received_at)
  where kind = 'bounced_soft';

create index email_webhook_events_age_idx on email_webhook_events (received_at);

alter table email_webhook_events enable row level security;

comment on table email_webhook_events is
  'Delivery events already applied, keyed by the provider''s event id. RLS on '
  'with no policies: service role only, like email_log. Rows older than 90 '
  'days are pruned by record_email_event itself.';

-- The recipient ceiling reads recent rows per address.
create index if not exists email_log_recipient_recent_idx
  on email_log (lower(recipient), created_at desc);

-- ---------------------------------------------------------------- ordering ---

create or replace function public.email_status_rank(p_status email_status)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'queued'     then 0
    when 'sent'       then 1
    when 'failed'     then 2
    when 'delivered'  then 2
    when 'bounced'    then 3
    when 'suppressed' then 3
    when 'complained' then 4
  end::smallint;
$$;

revoke all on function public.email_status_rank(email_status) from public, anon, authenticated;

-- ------------------------------------------------------------- the webhook ---

create or replace function public.record_email_event(
  p_event_id    text,
  p_provider_id text,
  p_kind        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    email_status;
  v_recipient text;
  v_matched   integer := 0;
  v_inserted  integer;
  v_soft      integer;
begin
  -- The ledger first: a replay stops here, before anything is counted twice.
  insert into email_webhook_events (event_id, kind, provider_id)
  values (p_event_id, p_kind, p_provider_id)
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('duplicate', true, 'matched', 0);
  end if;

  v_status := case p_kind
    when 'delivered'    then 'delivered'
    when 'bounced_hard' then 'bounced'
    when 'bounced_soft' then 'bounced'
    when 'complained'   then 'complained'
    when 'failed'       then 'failed'
    when 'suppressed'   then 'suppressed'
    when 'delayed'      then 'sent'
  end::email_status;

  -- Is this ours at all? One provider id is one message.
  select lower(recipient) into v_recipient
    from email_log
   where provider_id = p_provider_id
   limit 1;

  if v_recipient is null then
    -- Another site's mail on a shared account, or a message older than the
    -- outbox. Recorded as seen, acted on not at all.
    return jsonb_build_object('duplicate', false, 'matched', 0);
  end if;

  update email_webhook_events set recipient = v_recipient where event_id = p_event_id;

  -- Forward only. An equal or lower rank is an event that arrived late.
  update email_log
     set status       = v_status,
         delivered_at = case when v_status = 'delivered' then now() else delivered_at end,
         -- A provider-side failure after acceptance is final for this message:
         -- the sweeper must not resend something the provider already gave up
         -- on, and cannot tell it apart from one that never went.
         attempts     = case when v_status = 'failed' then 99 else attempts end,
         error        = case p_kind
                          when 'bounced_soft' then 'soft bounce (temporary)'
                          when 'bounced_hard' then 'hard bounce'
                          when 'failed'       then 'provider reported failure after accepting'
                          when 'suppressed'   then 'provider suppression list'
                          when 'complained'   then 'recipient marked as spam'
                          else error
                        end
   where provider_id = p_provider_id
     and public.email_status_rank(v_status) > public.email_status_rank(status);

  v_matched := 1;

  if p_kind = 'bounced_hard' then
    insert into email_suppressions (email, reason) values (v_recipient, 'hard_bounce')
    on conflict (email) do update set reason = 'hard_bounce';
  elsif p_kind = 'suppressed' then
    insert into email_suppressions (email, reason) values (v_recipient, 'provider')
    on conflict (email) do update
      set reason = case when email_suppressions.reason = 'complaint' then 'provider'
                        else email_suppressions.reason end;
  elsif p_kind = 'complained' then
    -- Never downgrade a stronger reason to the weaker complaint.
    insert into email_suppressions (email, reason) values (v_recipient, 'complaint')
    on conflict (email) do nothing;
  elsif p_kind = 'bounced_soft' then
    select count(*) into v_soft
      from email_webhook_events
     where kind = 'bounced_soft'
       and recipient = v_recipient
       and received_at > now() - interval '30 days';

    if v_soft >= 3 then
      insert into email_suppressions (email, reason) values (v_recipient, 'repeated_soft_bounce')
      on conflict (email) do update
        set reason = case when email_suppressions.reason = 'complaint' then 'repeated_soft_bounce'
                          else email_suppressions.reason end;
    end if;
  end if;

  -- Housekeeping, bounded by an index and done where the rows are written, so
  -- the ledger needs no cron of its own.
  delete from email_webhook_events where received_at < now() - interval '90 days';

  return jsonb_build_object('duplicate', false, 'matched', v_matched);
end;
$$;

revoke all on function public.record_email_event(text, text, text) from public, anon, authenticated;

-- The old entry point keeps working, with the same forward-only rule, for any
-- caller that still uses it.
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
  select count(*) into v_count from email_log where provider_id = p_provider_id;

  update email_log
     set status       = p_status,
         delivered_at = case when p_status = 'delivered' then now() else delivered_at end
   where provider_id = p_provider_id
     and public.email_status_rank(p_status) > public.email_status_rank(status);

  return v_count;
end;
$$;

revoke all on function public.mark_email_delivered(text, email_status) from public, anon, authenticated;

-- ----------------------------------------------------------------- claiming ---

-- A new argument means a new signature; the old one is dropped rather than
-- left as an overload that skips the rules below.
drop function if exists public.claim_email(text, text, text, uuid, text, uuid);

create or replace function public.claim_email(
  p_dedupe_key  text,
  p_template    text,
  p_recipient   text,
  p_user_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  -- Security notices: a password change, an account decision. Exempt from the
  -- complaint suppression and the recipient ceiling, never from a dead address.
  p_essential   boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_reason text;
  v_block  text;
  v_recent integer;
begin
  select reason into v_block from email_suppressions where email = lower(p_recipient);

  if public.is_undeliverable_domain(p_recipient) then
    v_reason := 'reserved domain, cannot receive mail';
  elsif v_block is not null and not (v_block = 'complaint' and p_essential) then
    v_reason := 'address is suppressed (' || v_block || ')';
  elsif not p_essential then
    -- Thirty an hour to one address is far past anything this product sends a
    -- person on purpose — the per-applicant notices have a digest mode for
    -- exactly that volume — and well short of what a loop would do.
    select count(*) into v_recent
      from email_log
     where lower(recipient) = lower(p_recipient)
       and created_at > now() - interval '1 hour'
       and status <> 'suppressed';
    if v_recent >= 30 then
      v_reason := 'recipient hourly ceiling reached';
    end if;
  end if;

  if v_reason is not null then
    insert into email_log (dedupe_key, template, recipient, user_id, entity_type, entity_id, status, error)
    values (p_dedupe_key, p_template, p_recipient, p_user_id, p_entity_type, p_entity_id,
            'suppressed', v_reason)
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

revoke all on function public.claim_email(text, text, text, uuid, text, uuid, boolean)
  from public, anon, authenticated;

-- ------------------------------------------------------------ rate limits ---

create table rate_limit_hits (
  bucket     text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_hits_bucket_idx on rate_limit_hits (bucket, created_at desc);

alter table rate_limit_hits enable row level security;

comment on table rate_limit_hits is
  'Counter for user-triggered actions that leave no row of their own (see '
  'migration 19). RLS on, no policies: written only through hit_rate_limit(), '
  'service role only.';

-- True and counted when the action may go ahead; false, and not counted, when
-- the bucket is full. The advisory lock makes check-and-insert one step for a
-- given bucket, so two concurrent requests cannot both take the last slot.
create or replace function public.hit_rate_limit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('rate:' || p_bucket));

  delete from rate_limit_hits
   where bucket = p_bucket
     and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count from rate_limit_hits where bucket = p_bucket;
  if v_count >= p_limit then
    return false;
  end if;

  insert into rate_limit_hits (bucket) values (p_bucket);
  return true;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
