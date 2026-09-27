-- =============================================================================
-- 69 — One event, one notification (the vocabulary half)
--
-- Every in-app notification so far was a bare insert from a trigger. That is
-- idempotent against the obvious duplicate (a double-click that saves the same
-- status twice changes nothing, so the status trigger does not fire), and
-- nothing else. The duplicates that do happen are the ones a trigger cannot
-- see:
--
--   apply → withdraw → apply   the employer's bell rang twice for one person
--                              on one listing, while the email outbox — keyed
--                              on (job, candidate, member) since round 3 —
--                              sent one message. Two channels, two answers.
--   shortlisted → new → shortlisted
--                              "your application moved to shortlisted", twice.
--   a status that flaps        verified → pending → verified, twice.
--   the expiry sweep           new in this pair: it runs nightly and again on
--                              every employer console load, and must write
--                              "your listing ended" once.
--
-- So a notification carries a dedupe key, like an email does, and the unique
-- index is the lock: the second writer loses the insert rather than a caller
-- having to remember to check. Unique per user rather than globally, because
-- one event is one notification *per recipient* — a company of three members
-- gets three rows under one key.
--
-- This file only adds the vocabulary. Postgres will not let a transaction use
-- an enum value the same transaction added, and db-push wraps each migration
-- in its own, so the functions that write these kinds live in migration 70 —
-- the same split migrations 20/21 and 51/52 made.
-- =============================================================================

-- Events the platform already acted on — an email went out for each — but
-- that never reached the bell. Somebody who does not read that inbox learned
-- about none of them.
alter type notification_kind add value if not exists 'job_expiring';               -- employer: ends in ≤ 3 days
alter type notification_kind add value if not exists 'job_expired';                -- employer: ended, can be reposted
alter type notification_kind add value if not exists 'company_verification_needed';-- employer: documents refused
alter type notification_kind add value if not exists 'profile_visibility_changed'; -- candidate: who can see you changed
alter type notification_kind add value if not exists 'password_changed';           -- anyone: security event

alter table notifications add column if not exists dedupe_key text;

comment on column notifications.dedupe_key is
  'What makes two notifications the same notification, per recipient. Written by the platform only; see migration 69.';

-- The lock. Partial so rows written before this migration (all null) need no
-- backfill and cannot collide.
create unique index if not exists notifications_dedupe_idx
  on notifications (user_id, dedupe_key)
  where dedupe_key is not null;

-- The feed is paged by (created_at, id) now rather than cut at 100, so the
-- index carries the tie-breaker too — two rows written by one trigger share a
-- created_at to the microsecond, and a page boundary between them would either
-- repeat one or skip one. Same lesson as migration 53.
create index if not exists notifications_feed_page_idx
  on notifications (user_id, created_at desc, id desc);
drop index if exists notifications_feed_idx;

-- ---------------------------------------------------------------------------
-- The guard, made to survive new columns
--
-- It listed the columns a reader may not touch, so a column added later —
-- dedupe_key, today — was writable by default. A reader who could rewrite the
-- key could clear it and let the next replay of the same event through. Now it
-- compares the whole row minus the one column a reader owns, so the next
-- column added is protected without anybody remembering this function exists.
-- ---------------------------------------------------------------------------

create or replace function public.guard_notification_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'only read_at is user-writable on a notification';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_notification_update() from public, anon, authenticated;
