-- =============================================================================
-- 11 — A reason with the decision
--
-- This board's whole argument is that a candidate should not have to guess:
-- the salary is written down, the commission is written down, who supplies the
-- leads is written down. Then an application moves to "rejected" and says
-- nothing at all, which is the one place the product stopped keeping its own
-- promise.
--
-- One optional line, written by the employer alongside the status change, and
-- shown to the candidate. Optional on purpose — a required field would be
-- filled with "not a fit" forever, which is worse than silence because it
-- looks like an answer.
-- =============================================================================

alter table applications
  add column decision_note text check (length(decision_note) <= 500);

comment on column applications.decision_note is
  'Employer''s reason for the current status. Visible to the candidate.';

-- ---------------------------------------------------------------------------
-- The guard has to widen by exactly one field.
--
-- Everything else stays frozen: an employer moves the pipeline and may now
-- explain the move, and still cannot touch the candidate's own submission —
-- their CV, their note, who they are, or when they applied.
-- ---------------------------------------------------------------------------

create or replace function public.guard_application_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if (new.job_id, new.candidate_id, new.cv_path, new.note, new.created_at)
     is distinct from
     (old.job_id, old.candidate_id, old.cv_path, old.note, old.created_at)
  then
    raise exception 'only the application status and decision note may be changed';
  end if;

  return new;
end;
$$;
