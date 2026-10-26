-- =============================================================================
-- 366 — A reminder on the bookmark
--
-- Renumbered from 20260101000365_a_reminder_on_the_bookmark.sql. Main's 365
-- is english_slugs_and_redirects, already applied live. #65 merged this file
-- under 365 beside it; production had not run the reminder. scripts/release/
-- migrations.mjs records that rename. This file is 366.
--
-- The note on a saved listing already lives on the bookmark (migration 356:
-- saved_jobs.note, saved_jobs_note_length, saved_jobs_owner_update). The
-- "remind me before it closes" was still only on the phone, so a bookmark
-- taken off on the website left a notification to go off, and a new phone
-- had none.
--
-- remind_at is that moment. The phone schedules its own notification from
-- it — the column is the truth, the phone's schedule a copy of it. Taking
-- the bookmark off deletes the row, and the reminder with it.
--
-- The update policy from 356 already lets the owner change their own row.
-- The guard below confines an update to the note and the reminder by
-- comparing the whole row with those two keys removed
-- (to_jsonb(new) - 'note' - 'remind_at'), so a column added later is
-- protected too. Which listing, whose bookmark and when it was made stay
-- what the insert wrote.
--
-- A reminder is a moment still to come, and not more than two years ahead.
-- now() is not immutable, so this is the trigger and not a check constraint.
-- It judges remind_at only when the value is set or changed, so existing
-- rows (the new column is null) are not failed, and editing the note later
-- does not re-judge a reminder that has since passed. It does not add
-- another policy, and it does not touch the storage policies on avatars or
-- company logos (migration 346), which stay server-only.
--
-- Written by setSavedJobReminder (src/lib/actions/saved-notes.ts), which the
-- app calls too. The note keeps going through setSavedJobNote. Tested in
-- supabase/tests/saved-notes.test.mjs.
-- =============================================================================

-- rollback: drop trigger if exists saved_jobs_guard_update on saved_jobs; drop function if exists public.guard_saved_job_update(); alter table saved_jobs drop column if exists remind_at;
-- safety: rls — no new policy. saved_jobs_owner_update (migration 356) already lets a candidate update their own row. The guard trigger confines that update to note and remind_at, so it cannot move a bookmark to another listing or another person
-- safety: ships-with-code — remind_at is nullable and nothing on main reads it until this code; the migration may go first. The new code selects the column, so the migration must reach production before the website deploy, as every migration does (docs/release)

alter table saved_jobs
  add column if not exists remind_at timestamptz;

comment on column saved_jobs.remind_at is
  'When the app reminds the candidate before this listing closes; null when no reminder is set. The phone''s scheduled notification is a copy of it. Set or changed only for a moment still to come, and not more than two years ahead.';

-- An update changes the note or the reminder, nothing else. A reminder that
-- is set or changed has to be still to come, and within two years.
create or replace function public.guard_saved_job_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and to_jsonb(new) - 'note' - 'remind_at'
         is distinct from to_jsonb(old) - 'note' - 'remind_at'
  then
    raise exception 'a saved job''s listing, owner and date do not change'
      using hint = 'Only the note and the reminder of a bookmark can be changed; take it off and save the other listing instead.';
  end if;

  if new.remind_at is not null
     and (tg_op = 'INSERT' or new.remind_at is distinct from old.remind_at)
     and (new.remind_at < now() or new.remind_at > now() + interval '2 years')
  then
    raise exception 'a reminder is in the future, and within two years'
      using hint = 'Set it for a moment still to come, and not more than two years ahead, or clear it.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_saved_job_update() from public, anon, authenticated;

drop trigger if exists saved_jobs_guard_update on saved_jobs;
create trigger saved_jobs_guard_update
  before insert or update on saved_jobs
  for each row execute function public.guard_saved_job_update();
