-- =============================================================================
-- 316 — Background work that survives a crash
--
-- rollback: the outbox — drop function public.lease_due_emails, settle_leased_email, reap_email_outbox, requeue_email, email_dead_letters, outbox_overview, email_retry_delay; restate claim_email (migration 68's seven-argument body, after dropping the eight-argument one), record_email_attempt, pending_emails and release_email_claim (migrations 27 and 302), record_email_event and email_status_rank (migration 68); alter table email_log drop column next_attempt_at, locked_until, lock_token, last_attempt_at, gave_up_at, leases, requeued_at. The runs — drop function public.begin_job_run, finish_job_run, prune_job_runs, scheduled_job_overview, recent_job_runs, job_freshness; drop table job_runs. The rest — restate pending_applicant_digests (51), guard_saved_search_update (09/38) and bump_version (50); alter table saved_searches drop column last_checked_at. The backfill below is not reversed: it only labels rows the old sweeper had already abandoned.
-- safety: rewrite — the backfill updates email_log rows by status with explicit where clauses; next_attempt_at is added without a default and given one afterwards, so no existing row is rewritten by the default
-- safety: ships-with-code — every changed function keeps its callers working: claim_email gains a trailing optional p_lock_token, record_email_attempt a trailing optional p_expected_attempts, pending_emails keeps its shape, and release_email_claim becomes a no-op so the sweeper still deployed on main, if this migration lands first, rebuilds into keys that are still held and sends nothing twice. The new cron code needs this migration first; deploy it before merging.
--
-- Renumbered from 69, then 315, as main moved to 313 and 314; rebuilt on main's own versions
-- of claim_email (p_essential and the hourly ceiling, migration 68),
-- record_email_event (the webhook ledger, migration 68) and pending_emails
-- (migration 302). What main already does is not repeated here: the webhook's
-- ordering and suppression are migration 68's, and file cleanup and expiry
-- are migration 204's lifecycle job.
--
-- Two pieces of machinery run without anyone watching: the outbox sweeper,
-- which retries email that did not go, and the scheduled jobs that expire
-- listings, send digests and alerts. An audit of both found that each is
-- correct on a good day and has no answer for a bad one.
--
-- The outbox
--
--   Unbounded retries. The sweeper "released" a failed row — attempts set to
--   99, dedupe key cleared — and re-ran the composer, which claimed a NEW row
--   with attempts 0 and a fresh created_at. So the three-attempt budget and
--   the three-day window were both measured on a row that was one hour old
--   every hour: a message failing transiently was retried forever, and the
--   admin view filled with a new `failed` row for it each time.
--
--   No backoff. A fixed hourly retry treats a provider that is down for a
--   day and a mailbox that was full for a minute the same way.
--
--   No lease. Two sweeps that overlap both read the same `pending_emails()`
--   and both rebuild the same messages. The dedupe index stops the second
--   send, which is why nobody noticed; it is still a race decided by luck,
--   and every lost race cost a provider call.
--
--   Invisible dead letters. A row that ran out of attempts simply stayed
--   `failed`, indistinguishable from one about to be retried, with no way to
--   put it back once the cause was fixed.
--
-- So the retry now happens IN PLACE, on the row that failed, under a lease:
--
--   lease_due_emails()     takes due rows with FOR UPDATE SKIP LOCKED and
--                          stamps them with a token and an expiry. Two
--                          sweepers never hold the same row; a sweeper that
--                          dies mid-batch lets go when the lease runs out.
--   claim_email(…, token)  when the composer re-runs and its dedupe key is
--                          held by the row this token leased, hands that row
--                          back instead of null — so the attempt count and
--                          the created_at the window is measured from carry
--                          over, and the budget finally bites.
--   record_email_attempt   counts real attempts (no more 99), schedules the
--                          next one with exponential backoff and jitter, and
--                          gives up at five.
--   settle_leased_email    finishes a leased row the composer did not record
--                          itself: nothing to send any more, not retryable,
--                          or the provider is not configured.
--   reap_email_outbox      dead-letters what fell out of the window and what
--                          crashed its worker eight times.
--   requeue_email          lets an admin put one dead letter back.
--
-- The scheduled jobs
--
--   Nothing recorded that a run started, finished, how long it took or why it
--   failed; the only evidence a nightly job had not run for a week was the
--   email it did not send. And nothing stopped two runs overlapping — Vercel
--   Cron retries, a manual trigger, a run that outlived its schedule.
--
--   job_runs is both the record and the lock: a unique index on (job) where
--   status = 'running' means a second begin_job_run() for the same job
--   cannot insert, and a run whose lease has lapsed — the function was killed
--   at its time limit and never said so — is closed as failed by the next
--   one, rather than holding the lock forever.
--
-- And two smaller things that were wrong in the same way, correct only if
-- every run happens on time: the applicant digest's fixed 24-hour window, and
-- saved-search alerts that re-checked the same 200 searches every week.
-- Plus one found on the way: a featured flag switching off counted as an
-- edit, which moved the moderation emails' dedupe keys between a failure and
-- its retry.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The outbox's new columns
--
-- next_attempt_at's default is five minutes in the future, not now. A row is
-- claimed and then sent inside an after() callback that outlives the response;
-- a sweeper that could lease it immediately would race the send it is meant to
-- be the backstop for. The old pending_emails() had the same five-minute grace
-- written as `created_at < now() - interval '5 minutes'`; as a default it
-- survives the retry path, which moves next_attempt_at on from there.
--
-- Added without the default and given it afterwards, so the existing rows are
-- not rewritten with a value the backfill below is about to replace anyway.
-- ---------------------------------------------------------------------------

alter table email_log
  add column if not exists next_attempt_at timestamptz,
  add column if not exists locked_until    timestamptz,
  add column if not exists lock_token      uuid,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists gave_up_at      timestamptz,
  add column if not exists leases          smallint not null default 0,
  add column if not exists requeued_at     timestamptz;

alter table email_log alter column next_attempt_at set default (now() + interval '5 minutes');

comment on column email_log.next_attempt_at is
  'When the sweeper may next try. Null once the row is finished or given up on.';
comment on column email_log.locked_until is
  'A sweeper''s lease on the row. Past it, the worker is presumed dead and the row is free again.';
comment on column email_log.leases is
  'How many times a sweeper has leased this row without the lease ending in a clean hand-back '
  '(a deferral gives its lease back). A row that crashes its worker every time is '
  'dead-lettered at eight rather than taking the sweeper down with it forever.';
comment on column email_log.gave_up_at is
  'Dead-lettered: retries exhausted, the failure was permanent, or the retry window elapsed.';
comment on column email_log.requeued_at is
  'An admin put this dead letter back in the queue. Restarts the three-day retry window.';

-- ---------------------------------------------------------------------------
-- Backfill, in an order that matters: each step only sees rows the earlier
-- ones left as they were.
-- ---------------------------------------------------------------------------

-- Released rows were superseded by the fresh row the old sweeper claimed in
-- their place. They are not dead letters — the message was retried, under
-- another row — so they should not appear in the view that asks an admin to
-- act on them.
--
-- Only the ones still counted as live work. The old release_email_claim()
-- checked no status, and neither did the old record_email_attempt(): a slow
-- after() send that finished between the old sweeper reading the row as
-- queued and releasing it left a row that says `sent` — and, once the
-- webhook caught up, `delivered` or `bounced` — while still carrying the
-- release marker. That row is a true record of a message that went, and of
-- a bounce the suppression list depends on; relabelling it cancelled would
-- erase both, and let a later webhook event move it again from rank zero.
update email_log
   set status          = 'cancelled',
       next_attempt_at = null
 where dedupe_key is null
   and error like '%(released for retry)%'
   and status in ('queued', 'failed');

-- Spent their budget under the old rules. Given up when they were written,
-- as far as anyone can now tell, which keeps them out of "given up this week".
--
-- Both dead-letter steps also say `failed`, whatever the row said before: a
-- `queued` row that was never retried is as dead as one that was, and the
-- dead-letter view and requeue_email() both read status = 'failed' — the
-- shape the reaper writes from here on.
update email_log
   set status          = 'failed',
       gave_up_at      = created_at,
       next_attempt_at = null
 where status in ('queued', 'failed')
   and attempts >= 3;

-- Still inside the old window with budget left: due now, and the new sweeper
-- picks them up on its first run — except the ones claimed in the last five
-- minutes. Those are probably mid-send in an after() callback at this very
-- moment, and the grace the column default gives every new row (and the old
-- pending_emails() gave as `created_at < now() - 5 minutes`) has to cover
-- them too: made due at once, the first sweep — or the old sweeper, still
-- deployed for the minutes between this migration and the code that goes
-- with it — would rebuild and send them a second time.
update email_log
   set next_attempt_at = greatest(now(), created_at + interval '5 minutes')
 where status in ('queued', 'failed')
   and gave_up_at is null
   and attempts < 3
   and created_at > now() - interval '3 days';

-- Past the window the old sweeper would have stopped at. Dead-lettered now,
-- and saying why, rather than retried days late.
update email_log
   set status          = 'failed',
       gave_up_at      = now(),
       next_attempt_at = null,
       error           = concat_ws(' ', error, '(retry window elapsed)')
 where status in ('queued', 'failed')
   and gave_up_at is null
   and attempts < 3
   and created_at <= now() - interval '3 days';

-- Everything else — sent, delivered, bounced, complained, suppressed — is
-- finished and was never going to be retried. The column was added without a
-- default so these are null already; stated for the reader, and for a re-run.
update email_log
   set next_attempt_at = null
 where status not in ('queued', 'failed')
   and next_attempt_at is not null;

-- ---------------------------------------------------------------------------
-- Indexes
--
-- The old pending index was keyed on created_at, which is no longer what the
-- sweeper orders by. The due index is partial on exactly the lease query's
-- fixed predicates, so it holds only live work however large the log grows.
-- ---------------------------------------------------------------------------

drop index if exists email_log_pending_idx;

create index if not exists email_log_due_idx on email_log (next_attempt_at)
  where status in ('queued', 'failed') and gave_up_at is null;

create index if not exists email_log_dead_idx on email_log (gave_up_at desc)
  where gave_up_at is not null;

-- pending_applicant_digests() asks "when did this person last get one" per
-- employer; without this it is a scan of the whole log for each of them.
create index if not exists email_log_digest_sent_idx on email_log (user_id, template, sent_at desc)
  where sent_at is not null;

-- ---------------------------------------------------------------------------
-- How long to wait after the n-th failed attempt.
--
-- ~10 minutes, 40 minutes, 2h40m, 10h40m, then give up at the fifth — so the
-- whole budget spans about fourteen hours, inside the three-day window with
-- room for a requeue. Capped at twelve hours so a later change to the base or
-- the attempt count cannot schedule a retry after the window has closed.
--
-- The ±20% jitter is so that a provider outage which failed four hundred
-- messages in the same minute does not retry all four hundred in the same
-- minute too, and fail them again for the same reason.
--
-- One function, because record_email_attempt and settle_leased_email both
-- schedule a failure and must not drift apart.
--
-- The exponent is clamped before it is used, not only the result: 4^19 ten-
-- minute intervals is past what an interval can hold, and Postgres raises
-- "interval out of range" before least() ever gets to cap it. By the sixth
-- attempt the cap has long since won, so the clamp changes no delay; it only
-- keeps a caller with a larger count (a raised MAX, an old row) from turning a
-- failed send into a failed statement.
-- ---------------------------------------------------------------------------

create or replace function public.email_retry_delay(p_attempt integer)
returns interval
language sql
volatile
set search_path = public
as $$
  select least(
           interval '10 minutes' * power(4, least(greatest(p_attempt, 1), 8) - 1),
           interval '12 hours'
         ) * (0.8 + random() * 0.4);
$$;

revoke all on function public.email_retry_delay(integer) from public, anon, authenticated;

-- The webhook's precedence (migration 68), restated only to rank the new
-- `cancelled` status: a row the sweeper closed with nothing left to send was
-- never accepted by the provider, so it ranks with `queued`. Without it the
-- function answers null for that status and every comparison is unknown.
create or replace function public.email_status_rank(p_status email_status)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'queued'     then 0
    when 'cancelled'  then 0
    when 'sent'       then 1
    when 'failed'     then 2
    when 'delivered'  then 2
    when 'bounced'    then 3
    when 'suppressed' then 3
    when 'complained' then 4
  end::smallint;
$$;

revoke all on function public.email_status_rank(email_status) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_email, now able to hand back a leased row
--
-- The body is migration 68's — reserved domains, suppressions (a complaint
-- does not stop an essential notice), the hourly ceiling per address, then the
-- insert that is the whole idempotency mechanism — with two additions, both
-- only when a sweeper passes its lease token:
--
--   the key is held by the row this token leased
--       → return that row's id, so the composer sends it and records the
--         attempt against it. That is the retry happening in place. The
--         recipient is refreshed because the composer has just looked it up
--         again and an address can change in three days; nothing else is,
--         because nothing else about "the same message" can.
--
--   the address has become suppressed, or hit its ceiling, since the first
--   attempt
--       → the leased row itself is marked suppressed. Without this the
--         insert below does nothing (the key is taken) and the row would be
--         settled as cancelled, which is true but hides the reason.
--
-- Dropped and recreated rather than replaced, because an eighth argument is a
-- different function to Postgres and `create or replace` would leave the
-- seven-argument one behind — callable, and ignorant of leases.
-- ---------------------------------------------------------------------------

drop function if exists public.claim_email(text, text, text, uuid, text, uuid, boolean);

create or replace function public.claim_email(
  p_dedupe_key  text,
  p_template    text,
  p_recipient   text,
  p_user_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  -- Security notices: a password change, an account decision. Exempt from the
  -- complaint suppression and the recipient ceiling, never from a dead address.
  p_essential   boolean default false,
  p_lock_token  uuid default null
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
    -- next_attempt_at stated as null: the column's default schedules a retry,
    -- and a refusal is finished the moment it is written.
    insert into email_log (dedupe_key, template, recipient, user_id, entity_type, entity_id,
                           status, error, next_attempt_at)
    values (p_dedupe_key, p_template, p_recipient, p_user_id, p_entity_type, p_entity_id,
            'suppressed', v_reason, null)
    on conflict (dedupe_key) do nothing;

    if p_lock_token is not null then
      update email_log
         set status          = 'suppressed',
             error           = v_reason,
             locked_until    = null,
             lock_token      = null,
             next_attempt_at = null
       where dedupe_key = p_dedupe_key
         and lock_token = p_lock_token
         and status in ('queued', 'failed');
    end if;

    return null;
  end if;

  insert into email_log (dedupe_key, template, recipient, user_id, entity_type, entity_id)
  values (p_dedupe_key, p_template, p_recipient, p_user_id, p_entity_type, p_entity_id)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  -- The key was taken. For anyone else that means "already handled"; for the
  -- sweeper holding the lease on that very row, it means "this is yours". A
  -- lease that has lapsed is not honoured — another sweeper may hold the row
  -- by now, and two senders is what the lease exists to prevent.
  if v_id is null and p_lock_token is not null then
    update email_log
       set recipient = p_recipient
     where dedupe_key   = p_dedupe_key
       and lock_token   = p_lock_token
       and locked_until > now()
       and status in ('queued', 'failed')
       and gave_up_at is null
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.claim_email(text, text, text, uuid, text, uuid, boolean, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- release_email_claim, disarmed
--
-- Nothing in the new code calls it: releasing a row — clearing its key so a
-- rebuild claims a stranger in its place — is exactly the unbounded retry
-- this migration removes. It is not dropped, because the old sweeper is still
-- deployed for the minutes between this migration and the code that goes with
-- it, and a missing function would fail that run loudly for no gain. Instead
-- it does nothing: the old sweeper's rebuild then finds the key still held and
-- claims nothing, which is the one outcome that can never send a message
-- twice. A later migration can drop it once no deployment remembers it.
-- ---------------------------------------------------------------------------

create or replace function public.release_email_claim(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Deliberately empty; see above.
  null;
end;
$$;

revoke all on function public.release_email_claim(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recording an attempt
--
-- Same signature as migration 27; the counting is what changed. attempts is
-- now the real number of times the provider was asked, because the retry is
-- on this row and the count is the budget. p_exhaust still spends the budget
-- at once for a permanent failure — by setting gave_up_at, not by writing 99
-- over the number an admin wants to read.
--
-- In an UPDATE's SET list every column reference is the row's OLD value, so
-- `attempts + 1` below is the attempt being recorded, consistently, in each
-- clause that uses it.
--
-- The status guard means a second record for the same attempt — a retried
-- RPC after a timeout that had in fact succeeded — can never turn a `sent`
-- row back into `failed`, or a delivered one into sent.
--
-- It cannot stop a second `failed`, though: the row is still `failed` after
-- the first record, so a replay passes the guard and counts the one real
-- failure twice — a backoff step skipped, and at the end a message dead-
-- lettered after four sends instead of five. deliver() retries this call on a
-- dropped connection, which is precisely when the first one may have
-- committed. So the caller says how many attempts the row had before this
-- one (p_expected_attempts: zero for a row it has just claimed, the leased
-- count for a retry), and the update matches only while that is still true.
-- The first record moves the count on, and a replay matches nothing. Null
-- keeps the old unguarded behaviour for any caller that does not know.
--
-- Dropped and recreated for the new argument, as claim_email above: `create
-- or replace` would leave the five-argument overload behind, unguarded.
-- ---------------------------------------------------------------------------

drop function if exists public.record_email_attempt(uuid, email_status, text, text, boolean);

create or replace function public.record_email_attempt(
  p_id                uuid,
  p_status            email_status,
  p_provider_id       text default null,
  p_error             text default null,
  p_exhaust           boolean default false,
  p_expected_attempts integer default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update email_log
     set status          = p_status,
         attempts        = attempts + 1,
         provider_id     = coalesce(p_provider_id, provider_id),
         error           = p_error,
         sent_at         = case when p_status = 'sent' then now() else sent_at end,
         last_attempt_at = now(),
         locked_until    = null,
         lock_token      = null,
         next_attempt_at = case
                             when p_status = 'failed'
                              and not coalesce(p_exhaust, false)
                              and attempts + 1 < 5
                              and gave_up_at is null
                             then now() + public.email_retry_delay(attempts + 1)
                           end,
         -- Kept if already given up (a late record for a reaped row must not
         -- revive it); cleared if it went after all, because a sent message
         -- is not a dead letter whatever happened before.
         gave_up_at      = case
                             when p_status <> 'failed' then null
                             when gave_up_at is not null then gave_up_at
                             when coalesce(p_exhaust, false) or attempts + 1 >= 5 then now()
                           end
   where id = p_id
     and status in ('queued', 'failed')
     and (p_expected_attempts is null or attempts = p_expected_attempts);
$$;

revoke all on function public.record_email_attempt(uuid, email_status, text, text, boolean, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leasing due rows
--
-- SKIP LOCKED rather than waiting: a second sweeper should take the next rows,
-- not queue behind the first. The row lock only lasts this statement; what
-- keeps the row for the length of the send is locked_until, which a crashed
-- sweeper cannot extend — so its rows come back on their own.
--
-- One token for the whole batch, computed once in its own CTE (a volatile
-- function in a CTE is evaluated once, not per row). It identifies this
-- lease, not the row; the row's id does that.
--
-- `leases < 8` and the reaper below are the crash bound: attempts only counts
-- sends that finished well enough to be recorded, so a message whose
-- composer takes the whole function down would otherwise be leased forever.
--
-- The window is measured from requeued_at when an admin has put the row back,
-- so a requeue is a real second chance rather than one the reaper takes away
-- again at its next run.
--
-- language sql, because a plpgsql RETURNS TABLE turns every output column
-- into a variable, and `id` and `attempts` would then be ambiguous in every
-- statement that mentions the table.
-- ---------------------------------------------------------------------------

create or replace function public.lease_due_emails(
  p_limit         integer default 25,
  p_lease_seconds integer default 120
)
returns table (id uuid, template text, entity_id uuid, user_id uuid, attempts smallint, lock_token uuid)
language sql
security definer
set search_path = public
as $$
  with due as (
    select e.id
      from email_log e
     where e.status in ('queued', 'failed')
       and e.gave_up_at is null
       and e.next_attempt_at <= now()
       and (e.locked_until is null or e.locked_until < now())
       and e.leases < 8
       and greatest(e.created_at, coalesce(e.requeued_at, e.created_at)) > now() - interval '3 days'
     order by e.next_attempt_at
     limit least(greatest(p_limit, 1), 100)
       for update skip locked
  ),
  lease as (
    select gen_random_uuid() as token
  )
  update email_log e
     set lock_token   = lease.token,
         locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         leases       = e.leases + 1
    from due, lease
   where e.id = due.id
  returning e.id, e.template, e.entity_id, e.user_id, e.attempts, e.lock_token;
$$;

revoke all on function public.lease_due_emails(integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settling a lease the composer did not record
--
-- Most retries end inside claim_email + record_email_attempt, like any send.
-- The rest end here: the composer ran and decided there was nothing to send,
-- or never got as far as a claim. Only the lease holder may settle — a
-- sweeper whose lease lapsed and was taken over gets false and does nothing,
-- rather than overwriting the outcome of the one that took it.
--
--   cancelled  nothing left to send (opted out, entity gone, superseded)
--   dead       will never work (no rebuilder for the template): give up now,
--              attempts untouched because the provider was never asked. The
--              reason is appended, not written over what the row said: the
--              first failure's provider text is what an admin needs to see.
--   defer      the provider is not configured in this environment: try in an
--              hour, not counted — the retry window still bounds it. "Not
--              counted" covers the lease too. lease_due_emails() spent one of
--              the row's eight to hand it out, and the eight exist to catch a
--              worker that dies on the row without ever settling it; a clean
--              deferral is the opposite of that, so it gives the lease back.
--              Without this a key missing for eight hours dead-lettered every
--              queued message as "a worker crashed on it", attempts zero.
--   failed     the composer threw: a failed attempt like any other, with
--              backoff and the same budget
-- ---------------------------------------------------------------------------

create or replace function public.settle_leased_email(
  p_id         uuid,
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
  if p_outcome is null or p_outcome not in ('cancelled', 'dead', 'defer', 'failed') then
    raise exception 'unknown outcome: %', p_outcome;
  end if;

  if p_outcome = 'cancelled' then
    update email_log
       set status          = 'cancelled',
           next_attempt_at = null,
           error           = p_detail,
           locked_until    = null,
           lock_token      = null
     where id = p_id and lock_token = p_lock_token and status in ('queued', 'failed');

  elsif p_outcome = 'dead' then
    update email_log
       set status          = 'failed',
           gave_up_at      = now(),
           next_attempt_at = null,
           error           = concat_ws(' ', error, p_detail),
           locked_until    = null,
           lock_token      = null
     where id = p_id and lock_token = p_lock_token and status in ('queued', 'failed');

  elsif p_outcome = 'defer' then
    update email_log
       set next_attempt_at = now() + interval '1 hour',
           error           = coalesce(p_detail, error),
           leases          = greatest(leases - 1, 0),
           locked_until    = null,
           lock_token      = null
     where id = p_id and lock_token = p_lock_token and status in ('queued', 'failed');

  else -- failed; the same arithmetic as record_email_attempt, old values throughout
    update email_log
       set status          = 'failed',
           attempts        = attempts + 1,
           last_attempt_at = now(),
           error           = p_detail,
           locked_until    = null,
           lock_token      = null,
           next_attempt_at = case
                               when attempts + 1 < 5
                               then now() + public.email_retry_delay(attempts + 1)
                             end,
           gave_up_at      = case when attempts + 1 >= 5 then now() end
     where id = p_id and lock_token = p_lock_token and status in ('queued', 'failed');
  end if;

  return found;
end;
$$;

revoke all on function public.settle_leased_email(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The reaper
--
-- Two ways a live row stops being worth trying, neither of which any single
-- attempt notices:
--
--   the window elapsed    three days after it was written (or requeued) a
--                         status update is news about something that has
--                         moved on; sending it now is worse than not
--   the worker keeps dying  eight leases without a recorded attempt means
--                         the composer crashes on this row every time
--
-- Rows under a live lease are left alone: a sweeper is working on them right
-- now, and pulling the row out from under it would turn its successful send
-- into an update that no longer matches.
-- ---------------------------------------------------------------------------

create or replace function public.reap_email_outbox()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update email_log e
     set status          = 'failed',
         gave_up_at      = now(),
         next_attempt_at = null,
         locked_until    = null,
         lock_token      = null,
         error           = concat_ws(' ', e.error, case
           when greatest(e.created_at, coalesce(e.requeued_at, e.created_at)) <= now() - interval '3 days'
             then '(retry window elapsed)'
           else '(lease expired 8 times: a worker crashed on it)'
         end)
   where e.status in ('queued', 'failed')
     and e.gave_up_at is null
     and (e.locked_until is null or e.locked_until < now())
     and (
       greatest(e.created_at, coalesce(e.requeued_at, e.created_at)) <= now() - interval '3 days'
       or e.leases >= 8
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reap_email_outbox() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Putting a dead letter back
--
-- One more try, not a fresh budget: attempts drops to four at most, so a
-- message that fails again goes straight back to the dead letters instead of
-- running another fourteen hours of backoff against a cause nobody fixed.
-- The lease count and the window start over, because both measure this
-- attempt at the problem rather than the last one.
--
-- Only `failed` dead letters: a suppressed address must be unsuppressed, not
-- requeued, and a cancelled row had nothing to say.
-- ---------------------------------------------------------------------------

create or replace function public.requeue_email(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  update email_log
     set gave_up_at      = null,
         next_attempt_at = now(),
         attempts        = least(attempts, 4),
         leases          = 0,
         requeued_at     = now(),
         locked_until    = null,
         lock_token      = null,
         error           = concat_ws(' ', error, '(requeued by admin)')
   where id = p_id
     and gave_up_at is not null
     and status = 'failed';

  return found;
end;
$$;

revoke all on function public.requeue_email(uuid) from public, anon;
grant execute on function public.requeue_email(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What the admin screens read
--
-- Gated the way email_activity() is: is_admin() in the where clause, so a
-- non-admin gets an empty answer rather than an error, and the table itself
-- stays closed.
-- ---------------------------------------------------------------------------

create or replace function public.email_dead_letters(p_limit integer default 100)
returns table (
  id              uuid,
  template        text,
  recipient       text,
  attempts        smallint,
  entity_type     text,
  entity_id       uuid,
  error           text,
  created_at      timestamptz,
  last_attempt_at timestamptz,
  gave_up_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.template, e.recipient, e.attempts, e.entity_type, e.entity_id,
         e.error, e.created_at, e.last_attempt_at, e.gave_up_at
    from email_log e
   where public.is_admin()
     and e.gave_up_at is not null
     and e.status = 'failed'
   order by e.gave_up_at desc, e.id
   limit least(greatest(p_limit, 1), 500);
$$;

revoke all on function public.email_dead_letters(integer) from public, anon;
grant execute on function public.email_dead_letters(integer) to authenticated;

-- One row of counts. "due" uses the lease query's own predicate, so the number
-- on the screen is the number the next sweep will actually take.
create or replace function public.outbox_overview()
returns table (
  due           integer,
  in_flight     integer,
  waiting       integer,
  dead          integer,
  oldest_due_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (
      where e.gave_up_at is null
        and e.next_attempt_at <= now()
        and (e.locked_until is null or e.locked_until < now())
        and e.leases < 8
        and greatest(e.created_at, coalesce(e.requeued_at, e.created_at)) > now() - interval '3 days'
    )::int,
    count(*) filter (
      where e.gave_up_at is null
        and e.locked_until >= now()
    )::int,
    count(*) filter (
      where e.gave_up_at is null
        and e.next_attempt_at > now()
        and (e.locked_until is null or e.locked_until < now())
    )::int,
    (select count(*)::int from email_log d
      where public.is_admin()
        and d.gave_up_at > now() - interval '30 days'
        and d.status = 'failed'),
    min(e.next_attempt_at) filter (
      where e.gave_up_at is null
        and e.next_attempt_at <= now()
        and (e.locked_until is null or e.locked_until < now())
    )
    from email_log e
   where public.is_admin()
     and e.status in ('queued', 'failed')
  -- An aggregate with no GROUP BY answers one row even over nothing, which to
  -- a non-admin would read as "the outbox is empty". No row is the honest
  -- refusal, as email_activity_summary() gives.
  having public.is_admin();
$$;

revoke all on function public.outbox_overview() from public, anon;
grant execute on function public.outbox_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- pending_emails, kept for its readers
--
-- Nothing in the send path calls it any more — the sweeper leases instead —
-- but its signature and shape stay, rewritten to the same "due" the lease
-- uses, so anything still reading it is told the truth about the queue rather
-- than a rule that no longer applies. Read-only: it takes no lease.
-- ---------------------------------------------------------------------------

create or replace function public.pending_emails(p_limit integer default 25)
returns table (id uuid, template text, entity_id uuid, user_id uuid, attempts smallint)
language sql
security definer
set search_path = public
as $$
  select e.id, e.template, e.entity_id, e.user_id, e.attempts
    from email_log e
   where e.status in ('queued', 'failed')
     and e.gave_up_at is null
     and e.next_attempt_at <= now()
     and (e.locked_until is null or e.locked_until < now())
     and e.leases < 8
     and greatest(e.created_at, coalesce(e.requeued_at, e.created_at)) > now() - interval '3 days'
   order by e.next_attempt_at
   limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.pending_emails(integer) from public, anon, authenticated;
grant execute on function public.pending_emails(integer) to service_role;

-- ---------------------------------------------------------------------------
-- The webhook ledger (migration 68), restated for one clause
--
-- A provider-side failure after acceptance sets attempts to 99 so the old
-- sweeper, which read attempts, would never resend it. The lease reads
-- next_attempt_at and gave_up_at instead, so those are set too — the row is a
-- dead letter, which is what it is. Migration 68's body otherwise, whole.
-- ---------------------------------------------------------------------------

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
         -- Final for this message, so a dead letter: listed, requeueable by
         -- an admin, and never leased again. Without these two the row sat
         -- `failed` with a next_attempt_at from its claim — due, leased,
         -- rebuilt and resent, which is what 99 was meant to prevent.
         gave_up_at      = case when v_status = 'failed' then now() else gave_up_at end,
         next_attempt_at = case when v_status = 'failed' then null else next_attempt_at end,
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

-- ---------------------------------------------------------------------------
-- job_runs: the record of every scheduled run, and the lock between them
--
-- stats holds counts and booleans only — "sent 12, skipped 3" — never an
-- address, a name or a payload. It is written by the service role and read by
-- admins, and that is still more readers than a candidate's email address
-- should have in a log table.
-- ---------------------------------------------------------------------------

create table if not exists job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null check (job ~ '^[a-z0-9-]{1,40}$'),
  status      text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  lease_until timestamptz,
  duration_ms integer,
  stats       jsonb not null default '{}' check (jsonb_typeof(stats) = 'object'),
  error       text check (error is null or length(error) <= 500)
);

-- This index is the per-job lock. Two runs of the same job cannot both be
-- `running`, whichever process, region or retry they came from, because the
-- second insert has nowhere to go.
create unique index if not exists job_runs_one_running on job_runs (job) where status = 'running';

create index if not exists job_runs_job_started_idx on job_runs (job, started_at desc);

alter table job_runs enable row level security;

-- No policies, as on email_log: service role only, admins through the
-- functions below. The explicit revoke is belt and braces — RLS with no
-- policies already answers zero rows to anyone who asks.
revoke all on job_runs from anon, authenticated;

comment on table public.job_runs is
  'One row per scheduled-job execution; the unique index job_runs_one_running is the per-job '
  'lock. RLS enabled with no policies deliberately — service role only, admins read through '
  'scheduled_job_overview() and recent_job_runs(). stats holds counts only, never payloads.';

-- ---------------------------------------------------------------------------
-- Taking the lease
--
-- First, close any run whose lease has lapsed. That run's function was killed
-- at its platform time limit or crashed without reaching finish_job_run(), and
-- until it is closed it holds the lock; left alone, one bad night would stop
-- the job for good. Closed as failed, with the reason, because that is what
-- happened and the overview should say so.
--
-- Then try to insert this run as `running`. If another live run holds the
-- index, record a `skipped` run — so an overlap is visible on the screen, not
-- just absent — and return null for the caller to stop.
--
-- The lapsed run's duration is measured to its lease_until, which is when it
-- was last known to be alive, and clamped to what the integer column holds.
-- The close runs for every job, not only this one, so a run left `running`
-- through a long pause — the project paused, the crons switched off for a
-- month — would otherwise overflow the cast (2^31 ms is under 25 days), fail
-- this statement for every job that ever called it again, and stop the whole
-- scheduler over one row nobody could then close.
-- ---------------------------------------------------------------------------

create or replace function public.begin_job_run(p_job text, p_lease_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update job_runs
     set status      = 'failed',
         finished_at = now(),
         duration_ms = least(greatest(extract(epoch from (lease_until - started_at)) * 1000, 0),
                             2147483647)::int,
         lease_until = null,
         error       = 'lease expired: the worker crashed or timed out before finishing'
   where status = 'running'
     and lease_until < now();

  insert into job_runs (job, status, lease_until)
  values (p_job, 'running', now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 0), 30)))
  on conflict (job) where status = 'running' do nothing
  returning id into v_id;

  if v_id is null then
    insert into job_runs (job, status, finished_at, duration_ms, error)
    values (p_job, 'skipped', now(), 0, 'another run holds the lease');
    return null;
  end if;

  return v_id;
end;
$$;

revoke all on function public.begin_job_run(text, integer) from public, anon, authenticated;

-- Closing a run. clock_timestamp() rather than now(): the duration is the
-- point of the row, and now() is frozen at the start of this transaction.
-- Only a `running` row is closed, so a run that was declared dead by the next
-- one's begin_job_run() cannot come back and rewrite that verdict. Clamped
-- like the lapsed-run close above, although a live run is bounded by its
-- function's time limit: one overflow here would fail the very call that
-- records how the run ended.
create or replace function public.finish_job_run(
  p_id     uuid,
  p_status text,
  p_stats  jsonb default '{}',
  p_error  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('succeeded', 'failed') then
    raise exception 'a run finishes as succeeded or failed, not %', p_status;
  end if;

  update job_runs
     set status      = p_status,
         finished_at = clock_timestamp(),
         duration_ms = least(extract(epoch from (clock_timestamp() - started_at)) * 1000,
                             2147483647)::int,
         stats       = coalesce(p_stats, '{}'),
         error       = left(p_error, 500),
         lease_until = null
   where id = p_id
     and status = 'running';

  return found;
end;
$$;

revoke all on function public.finish_job_run(uuid, text, jsonb, text) from public, anon, authenticated;

-- Hourly runs make ~9,000 rows a year per job. Ninety days is long enough to
-- see a pattern ("fails every Monday") and short enough that the table never
-- matters. Running rows are never pruned: begin_job_run() closes them first.
create or replace function public.prune_job_runs(p_keep interval default '90 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from job_runs
   where status <> 'running'
     and started_at < now() - coalesce(p_keep, interval '90 days');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_job_runs(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the operations screen and the health check read
--
-- The "last run" is the last one that was not skipped: a skip says another run
-- was busy, which is information about that run, not a verdict on the job.
-- `running` counts only a live lease, so a crashed run still waiting to be
-- closed by the next begin_job_run() does not show as in progress.
-- ---------------------------------------------------------------------------

create or replace function public.scheduled_job_overview()
returns table (
  job              text,
  last_started_at  timestamptz,
  last_status      text,
  last_duration_ms integer,
  last_error       text,
  last_stats       jsonb,
  last_success_at  timestamptz,
  failures_7d      integer,
  running          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select j.job,
         l.started_at,
         l.status,
         l.duration_ms,
         l.error,
         l.stats,
         (select max(s.finished_at) from job_runs s
           where s.job = j.job and s.status = 'succeeded'),
         (select count(*)::int from job_runs f
           where f.job = j.job and f.status = 'failed'
             and f.started_at > now() - interval '7 days'),
         exists (select 1 from job_runs r
                  where r.job = j.job and r.status = 'running' and r.lease_until > now())
    from (select distinct r.job from job_runs r where public.is_admin()) j
    left join lateral (
      select r.started_at, r.status, r.duration_ms, r.error, r.stats
        from job_runs r
       where r.job = j.job and r.status <> 'skipped'
       order by r.started_at desc, r.id
       limit 1
    ) l on true
   order by j.job;
$$;

revoke all on function public.scheduled_job_overview() from public, anon;
grant execute on function public.scheduled_job_overview() to authenticated;

create or replace function public.recent_job_runs(
  p_limit integer default 50,
  p_job   text default null
)
returns setof job_runs
language sql
stable
security definer
set search_path = public
as $$
  select r.*
    from job_runs r
   where public.is_admin()
     and (p_job is null or r.job = p_job)
   order by r.started_at desc, r.id
   limit least(greatest(p_limit, 1), 200);
$$;

revoke all on function public.recent_job_runs(integer, text) from public, anon;
grant execute on function public.recent_job_runs(integer, text) to authenticated;

-- For /api/health, which runs as the service role and turns these into
-- booleans before anything leaves the server.
create or replace function public.job_freshness()
returns table (job text, last_success_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.job, max(r.finished_at) filter (where r.status = 'succeeded')
    from job_runs r
   group by r.job;
$$;

revoke all on function public.job_freshness() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The applicant digest, measured from the last one sent
--
-- Migration 51's body, with the window changed. It was "applications in the
-- last 24 hours", which is right only if the job ran exactly 24 hours ago: a
-- missed night dropped a day of applicants from every digest, silently, and a
-- late run double-counted the overlap. Now it starts where this person's last
-- digest left off, falling back to p_since for someone who has never had one,
-- and never reaches back more than seven days — past that, a digest is a
-- backlog, and the applicants page is where it belongs.
--
-- "Where it left off" is when that digest's list was taken, not when it was
-- sent. The job asks this function once and then sends each digest in turn
-- for up to a minute, and sent_at is stamped after the provider answers — so
-- an application that arrived between the list and that employer's send was
-- in neither today's digest (the list was already taken) nor tomorrow's (it is
-- older than sent_at). In digest mode the per-application notice stands down,
-- so nothing else would ever have told the employer. The list's time is the
-- start of the daily-digest run that sent it: job_runs records it before the
-- work begins, so it is always at or before this function's own now().
-- Skipped runs are not the one that sent anything, and a run that started
-- more than an hour before the send cannot have been it (the job's time limit
-- is a minute), so a gap in the record never anchors the window to some older
-- night and counts a day twice. If no run is on record
-- (pruned, or a digest sent before job_runs existed), sent_at is the fallback,
-- which is what this was before. An application in the milliseconds between
-- the run starting and the list being taken may be counted twice; that is the
-- side to err on, and none is ever counted never.
-- ---------------------------------------------------------------------------

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
    join applications a on a.job_id = j.id
   where p.notify_applications = true
     and p.notify_applicant_digest = true
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

revoke all on function public.pending_applicant_digests(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Saved-search alerts get a cursor
--
-- The alert job took 200 searches ordered by last_sent_at. A search with
-- nothing new never sends, so its last_sent_at never moves, so it is first in
-- line again next week — and past 200 such searches, the same ones were
-- checked every Monday and the rest never were. last_checked_at moves on
-- every look, sent or not, so the line actually advances.
-- ---------------------------------------------------------------------------

alter table saved_searches add column if not exists last_checked_at timestamptz;

create index if not exists saved_searches_alert_due_idx
  on saved_searches (last_checked_at nulls first)
  where alerts;

-- Migration 09's guard, restated whole with the one new column. An owner who
-- could reset last_checked_at could jump the queue ahead of everyone else's
-- alerts, which is the same abuse the last_sent_at rule exists for. The SET
-- clause is migration 38's: create or replace drops one it is not given.
create or replace function public.guard_saved_search_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.last_sent_at is distinct from old.last_sent_at then
    raise exception 'last_sent_at is set by the alert job, not by the owner';
  end if;
  if new.last_checked_at is distinct from old.last_checked_at then
    raise exception 'last_checked_at is set by the alert job, not by the owner';
  end if;
  if new.candidate_id is distinct from old.candidate_id then
    raise exception 'a saved search cannot change owner';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_saved_search_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A page view is not an edit
--
-- Migration 50's version counter moves on every UPDATE of a listing, and
-- increment_job_view() is an UPDATE — so every public view of a live listing
-- moved it. Two things read that number as "the listing changed":
--
--   the moderation notices' dedupe keys (job_approved:<id>:<version>). By the
--   time the sweeper retried a failed approval notice, a live listing had
--   been viewed and its key had moved, so the retry claimed a brand-new row
--   at attempts 0 and cancelled the old one as superseded — the retry-forever
--   chain this migration exists to end, rebuilt one row at a time;
--
--   the edit form's optimistic lock, which refused an employer's save as a
--   conflict with a "colleague" who was in fact a visitor reading the ad.
--
-- Featuring a listing, and the lifecycle job un-featuring it when the period
-- runs out, are the same kind of write: nobody's edit, and the employer's
-- form never writes those columns, so no edit can be lost by not counting
-- them. Counting them moved the moderation keys the same way.
--
-- So an update that changes only view_count, is_featured or featured_until
-- leaves the version where it was. Anything else — including a no-op write, which migration 50
-- counts on purpose — still moves it. The comparison drops the columns this
-- kind of write touches (those three, and updated_at in case a trigger stamps
-- it), version itself, and search_vector: a stored generated column reads as
-- null in a BEFORE trigger's NEW, so it always looks changed there, and it is
-- derived from columns the comparison already covers. On companies, which
-- have no view_count, the first condition is never true and nothing changes.
-- Migration 50's body otherwise, restated whole.
-- ---------------------------------------------------------------------------

create or replace function public.bump_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Columns the platform writes on its own. A change confined to these is not
  -- an edit: it must not raise an edit conflict or move a dedupe key.
  v_system constant text[] := array[
    'view_count', 'is_featured', 'featured_until', 'updated_at', 'version', 'search_vector'
  ];
begin
  -- Something the platform owns changed, and nothing else did. Asked of the
  -- three columns by name rather than as "the rows differ": search_vector
  -- reads as null in a BEFORE trigger's NEW, so whole rows always differ, and
  -- a true no-op write — which migration 50 counts on purpose — would slip
  -- through as a system write. On companies none of the three exist, the
  -- first condition is never true, and every write still counts.
  if (   (to_jsonb(new) ->> 'view_count')     is distinct from (to_jsonb(old) ->> 'view_count')
      or (to_jsonb(new) ->> 'is_featured')    is distinct from (to_jsonb(old) ->> 'is_featured')
      or (to_jsonb(new) ->> 'featured_until') is distinct from (to_jsonb(old) ->> 'featured_until'))
     and (to_jsonb(new) - v_system) = (to_jsonb(old) - v_system)
  then
    new.version := old.version;
    return new;
  end if;

  -- Every other update, including ones that change nothing else: a no-op
  -- write is still a write, and treating it as one keeps the number honest.
  new.version := old.version + 1;
  return new;
end;
$$;

revoke execute on function public.bump_version() from public, anon, authenticated;
