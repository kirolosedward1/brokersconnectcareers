-- =============================================================================
-- 365 — A reminder on the bookmark
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
-- The guard below confines an update to the note and the reminder: which
-- listing, whose bookmark and when it was made stay what the insert wrote.
-- It does not add another policy, and it does not touch the storage policies
-- on avatars or company logos (migration 346), which stay server-only.
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
  'When the app reminds the candidate before this listing closes; null when no reminder is set. The phone''s scheduled notification is a copy of it.';

-- An update changes the note or the reminder, nothing else.
create or replace function public.guard_saved_job_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.candidate_id is distinct from old.candidate_id
     or new.job_id is distinct from old.job_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'a saved job''s listing, owner and date do not change'
      using hint = 'Only the note and the reminder of a bookmark can be changed; take it off and save the other listing instead.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_saved_job_update() from public, anon, authenticated;

drop trigger if exists saved_jobs_guard_update on saved_jobs;
create trigger saved_jobs_guard_update
  before update on saved_jobs
  for each row execute function public.guard_saved_job_update();
