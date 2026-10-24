-- =============================================================================
-- 368 — A note is deleted by its author while they still work the listing
--
-- application_notes_delete (migration 58) asked only that the caller wrote
-- the note. Every other notes policy also asks owns_job(), which since 308
-- includes good standing. So an author who was suspended, or who left the
-- company, could still erase what they had written on the team's applicants
-- — the kind of record a suspension is meant to freeze. PostgREST sends an
-- unfiltered DELETE as-is, and with no WHERE or RETURNING to read the rows
-- the select policy never applies, so the delete policy was the only check.
--
-- Now the same two facts as the write policy: their note, on an application
-- to a listing they still own through a company in good standing.
-- =============================================================================

-- rollback: drop policy if exists application_notes_delete on application_notes; create policy application_notes_delete on application_notes for delete using (author_id = (select auth.uid()));
-- safety: rls — narrows a delete policy: a working author deletes their own notes exactly as before; only an author who no longer owns the listing (suspended, or left the company) is refused
-- safety: ships-with-code — no code deletes a note for somebody who has left or been suspended; the inbox only offers delete on the author's own notes, which it draws for working members

drop policy if exists application_notes_delete on application_notes;

create policy application_notes_delete on application_notes
  for delete using (
    author_id = (select auth.uid())
    and exists (
      select 1 from applications a
       where a.id = application_notes.application_id
         and public.owns_job(a.job_id)
    )
  );
