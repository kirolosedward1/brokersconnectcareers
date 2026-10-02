-- =============================================================================
-- 341 — A push asks again before it goes
--
-- What a person chose for their phone (migration 335) was asked once, when a
-- push was queued. Two pushes got past it:
--
--   a retry      Expo failing at half past nine at night: the retries at one,
--                five and thirty minutes and then two hours put the push on
--                the phone after midnight, quiet hours or not.
--   a held push  queued at half past eleven to wait for eight; its kind
--                switched off at seven: it still went at eight.
--
-- Now the choice is asked again as pushes are handed out to be sent
-- (lease_due_pushes): a kind switched off since is settled as skipped, and a
-- push that comes due inside the night it should wait out — a retry, or
-- quiet hours turned on since it was queued — is put back to eight.
-- push_due_at() answers both, for one push at one moment.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: restate lease_due_pushes() from migration 329; drop function if exists public.push_due_at(bigint, timestamptz);
-- safety: ships-with-code — lease_due_pushes keeps its arguments and the shape of its answer, so the code calls it the same way before and after; the only difference is a push the person would not want now being held or skipped

-- When a queued push may go, if it is asked at p_at: null when its kind has
-- been switched off since it was queued, otherwise p_at itself or the end of
-- the night it falls in (push_hold_until, migration 335). Somebody without a
-- profile row has the defaults: every kind on, no quiet hours.
create or replace function public.push_due_at(p_id bigint, p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when not coalesce(
      case public.push_category(n.kind)
        when 'job_alerts' then p.push_job_alerts
        when 'applications' then p.push_applications
        else p.push_account
      end,
      true
    ) then null
    else public.push_hold_until(n.kind, p_at, p.push_quiet_hours)
  end
    from push_outbox o
    join notifications n on n.id = o.notification_id
    left join profiles p on p.id = o.user_id
   where o.id = p_id;
$$;

revoke all on function public.push_due_at(bigint, timestamptz) from public, anon, authenticated;

-- Migration 329's, asking again before anything is handed out.
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

  -- What the person wants now: a kind switched off since is not sent, and a
  -- push due inside quiet hours waits for eight.
  with due as (
    select q.id, public.push_due_at(q.id, now()) as at
      from push_outbox q
     where q.status = 'queued'
       and q.next_attempt_at <= now()
       and (q.lease_until is null or q.lease_until < now())
       for update skip locked
  )
  update push_outbox o
     set status          = case when due.at is null then 'skipped' else o.status end,
         settled_at      = case when due.at is null then now() else o.settled_at end,
         detail          = case when due.at is null then 'switched off' else o.detail end,
         next_attempt_at = coalesce(due.at, o.next_attempt_at)
    from due
   where o.id = due.id
     and (due.at is null or due.at > now());

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
