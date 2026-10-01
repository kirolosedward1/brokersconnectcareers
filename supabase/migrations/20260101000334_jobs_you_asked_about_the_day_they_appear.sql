-- =============================================================================
-- 334 — Jobs you asked about, the day they appear
--
-- A daily job (/api/cron/new-jobs) runs each saved search that has alerts on
-- through the board's own query, and tells its owner in the bell about what
-- was published since it last looked: one notification per person per Cairo
-- day, naming the search or the followed company when only one found
-- something, counting otherwise. It reaches a phone like any notification
-- (enqueue_push, migration 329). The Monday email is unchanged.
--
-- What the job needs from the database:
--
--   saved_searches.bell_checked_at — when the daily job last looked at the
--     search. Its own cursor, apart from the weekly email's last_checked_at,
--     so neither job moves the other's place. Server-owned like that one: an
--     owner who could reset it would have the day's jobs announced again.
--
--   record_new_jobs_notification(user, payload, href) — writes the day's
--     notification, keyed new_jobs:<Cairo date>, so a second run the same day
--     (a retry, a manual call) adds nothing. Returns the row's id, or null
--     when today's was already written or the person is not a candidate.
--     Service role only.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: drop function public.record_new_jobs_notification(uuid, jsonb, text); restate guard_saved_search_update() from migration 324; alter table saved_searches drop column bell_checked_at;
-- safety: ships-with-code — the column and the function are new and only the daily job uses them: applied first, nothing changes; the job deployed first fails its runs (recorded in job_runs) until this is applied

alter table saved_searches add column if not exists bell_checked_at timestamptz;

comment on column saved_searches.bell_checked_at is
  'When the daily new-jobs job last looked at this search (/api/cron/new-jobs). Written by the job only.';

-- Migration 324's guard, restated whole with the one new column. The SET
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
  if new.bell_checked_at is distinct from old.bell_checked_at then
    raise exception 'bell_checked_at is set by the daily job, not by the owner';
  end if;
  if new.candidate_id is distinct from old.candidate_id then
    raise exception 'a saved search cannot change owner';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_saved_search_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The day's notification
-- ---------------------------------------------------------------------------

create or replace function public.record_new_jobs_notification(p_user uuid, p_payload jsonb, p_href text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- IS DISTINCT FROM, not <>: a field that is missing reads as null, and a
  -- null comparison would let the payload through unchecked.
  if p_user is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'record_new_jobs_notification: a person and a payload are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'count') is distinct from 'number' then
    raise exception 'record_new_jobs_notification: the payload needs a count' using errcode = '22023';
  end if;
  if (p_payload ->> 'count')::numeric < 1 then
    raise exception 'record_new_jobs_notification: nothing new to tell' using errcode = '22023';
  end if;

  -- Saved searches are a candidate's; whoever has stopped being one (an
  -- account moved to employer keeps its rows) is not told about jobs.
  if not exists (select 1 from profiles where id = p_user and role = 'candidate') then
    return null;
  end if;

  insert into notifications (user_id, kind, payload, href, dedupe_key)
  values (p_user, 'new_jobs', p_payload, p_href,
          'new_jobs:' || to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD'))
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_new_jobs_notification(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_new_jobs_notification(uuid, jsonb, text) to service_role;
