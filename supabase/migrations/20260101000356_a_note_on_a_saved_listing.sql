-- =============================================================================
-- 356 — A note on a saved listing lives with the bookmark
--
-- The app let a candidate keep a line about a saved listing ("spoke to Mona,
-- interview Sunday") on the phone alone: the website's saved page never
-- showed it, and a new phone lost it. The note is the bookmark's now — a
-- column on saved_jobs, read and written by whoever owns the row, on both
-- sides — and goes with the bookmark when it is taken off, as the app's did.
--
-- Up to 300 characters, as the app's sheet counted them; empty is null, not
-- "". Written through the website's setSavedJobNote action (which the app
-- calls), so the trim and the cap are applied once; the check here is what
-- the API cannot get past.
-- =============================================================================

-- rollback: drop policy if exists saved_jobs_owner_update on saved_jobs; alter table saved_jobs drop column if exists note;
-- safety: rls, ships-with-code — the new policy lets a candidate update their own saved_jobs row and nothing else (the same owner test the select and delete policies apply); the column is nullable and read by nothing until the code that writes it, so the code before the migration sees no change and the migration before the code adds an empty column

alter table saved_jobs
  add column if not exists note text
    constraint saved_jobs_note_length check (note is null or char_length(note) between 1 and 300);

comment on column saved_jobs.note is
  'A line the candidate keeps for themselves about the listing, on the website and in the app alike; 1–300 characters or null.';

drop policy if exists saved_jobs_owner_update on saved_jobs;
create policy saved_jobs_owner_update on saved_jobs
  for update
  using (candidate_id = (select auth.uid()))
  with check (candidate_id = (select auth.uid()));
