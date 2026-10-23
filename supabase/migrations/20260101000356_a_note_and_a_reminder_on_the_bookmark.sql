-- =============================================================================
-- 356 — A note and a reminder on the bookmark
--
-- The app let a candidate keep a line about a saved listing ("spoke to Mona,
-- interview Sunday") and a "remind me before it closes", both on the phone
-- alone (AsyncStorage, mobile/src/features/saved/notes.ts and reminders.ts).
-- So the website's /dashboard/saved never showed the note, a new phone started
-- with none of either, and a bookmark taken off on the website left the
-- phone's reminder to go off for a listing nobody had saved any more.
--
-- Both now live on the bookmark itself:
--
--   note       what the candidate wrote, at most 300 characters (NOTE_MAX in
--              the app, the website's own form) and never only blanks; null
--              when there is none
--   remind_at  when the phone should remind them before the listing closes;
--              null when no reminder is set. The phone schedules its own
--              notification from it — the column is the truth, the phone's
--              schedule a copy of it.
--
-- Taking the bookmark off deletes the row, and the note and reminder with it:
-- the same row, so nothing is left behind to go off.
--
-- Changing them is an update of the candidate's own row. saved_jobs had no
-- update policy — a bookmark was only ever added or taken away — so one is
-- added with the same owner test as the read and delete halves (migration
-- 322), and a guard keeps an update to the two new columns: which listing,
-- whose bookmark and when it was made stay what the insert wrote. Who may see
-- or remove a row is unchanged.
--
-- Written by the website's actions setSavedJobNote and setSavedJobReminder
-- (src/lib/actions/saved-notes.ts), which the app calls too. Tested in
-- supabase/tests/saved-notes.test.mjs.
-- =============================================================================

-- rollback: drop trigger saved_jobs_guard_update on saved_jobs; drop function public.guard_saved_job_update(); drop policy saved_jobs_owner_update on saved_jobs; alter table saved_jobs drop constraint saved_jobs_note_shape; alter table saved_jobs drop column note, drop column remind_at;
-- safety: constraint — saved_jobs_note_shape is added with the column it checks, which is null on every existing row, so no row can fail it
-- safety: rls — a new update policy on saved_jobs, owner-only (candidate_id = auth.uid() in both using and with check, as the select and delete policies already are); the guard trigger below confines an update to note and remind_at, so it cannot move a bookmark to another listing or another person
-- safety: ships-with-code — the columns are nullable and nothing reads them until the code on this branch does; the old code never selects them and the old app keeps its notes on the phone, so the migration may go first. The new code needs the migration (it selects the columns), so the migration must reach production before the website deploy, as every migration does (docs/release)

alter table saved_jobs
  add column note text,
  add column remind_at timestamptz;

alter table saved_jobs
  add constraint saved_jobs_note_shape
  check (note is null or (char_length(note) <= 300 and btrim(note) <> ''));

comment on column saved_jobs.note is
  'The candidate''s own line about this saved listing, at most 300 characters; null when none. Theirs alone: read and written only through their own row.';
comment on column saved_jobs.remind_at is
  'When the app reminds the candidate before this listing closes; null when no reminder is set. The phone''s scheduled notification is a copy of it.';

create policy saved_jobs_owner_update on saved_jobs
  for update
  using (candidate_id = (select auth.uid()))
  with check (candidate_id = (select auth.uid()));

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

create trigger saved_jobs_guard_update
  before update on saved_jobs
  for each row execute function public.guard_saved_job_update();
