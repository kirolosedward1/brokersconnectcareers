-- =============================================================================
-- 356 — A CV line, or a note, written twice by one retry
--
-- Migration 55 gave a listing a key the form makes once and repeats on every
-- retry, because a client that gives up after the server has committed sends
-- the same request again, and a second insert is a second advert. The same
-- thing happens to the four other creates with no natural key of their own:
-- a job, a school or a certificate on a consultant's CV, and an employer's
-- note on an applicant. On a phone between towers, or a laptop on café Wi-Fi,
-- "save" times out, the person presses it again, and the CV shows the same
-- job twice; the applicant's card the same note twice.
--
-- The app has been asking the database afterwards whether the row went in
-- (mobile/src/features/profile/queries.ts, employer/applicants.ts). The
-- website did not, and asking afterwards is a guess with the rows as they
-- are: the same key on both requests is the answer.
--
-- Nullable, and unique only where present, as on jobs: every row written
-- before this has no key, and none of them may collide with each other.
-- A key is unique per owner — per CV, per application — so one person's
-- key can never land on, or reveal, another's row.
-- =============================================================================

-- rollback: drop index agent_experience_idempotency_key_idx, agent_education_idempotency_key_idx, agent_certifications_idempotency_key_idx, application_notes_idempotency_key_idx; alter table agent_experience drop column idempotency_key; alter table agent_education drop column idempotency_key; alter table agent_certifications drop column idempotency_key; alter table application_notes drop column idempotency_key;
-- safety: constraint — partial unique indexes on a column added empty in this same file, so no existing row can violate them; the tables hold a few rows per consultant or applicant, and the brief lock while each index builds is shorter than one save
-- safety: ships-with-code — the columns are nullable with no default. Before this file, the new code's key is refused by PostgREST as an unknown column, so the actions send it only once the column exists (src/lib/actions/idempotency.ts reads the refusal and saves without it); after it without the new code, main's actions send no key and write exactly as they do today

alter table agent_experience add column if not exists idempotency_key uuid;
alter table agent_education add column if not exists idempotency_key uuid;
alter table agent_certifications add column if not exists idempotency_key uuid;
alter table application_notes add column if not exists idempotency_key uuid;

create unique index if not exists agent_experience_idempotency_key_idx
  on agent_experience (agent_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists agent_education_idempotency_key_idx
  on agent_education (agent_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists agent_certifications_idempotency_key_idx
  on agent_certifications (agent_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists application_notes_idempotency_key_idx
  on application_notes (application_id, idempotency_key)
  where idempotency_key is not null;
