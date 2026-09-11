-- =============================================================================
-- 55 — The retry that posts a second advert
--
-- Every other create in this product converges when it is repeated: an
-- application has a unique (job_id, candidate_id), a saved job a composite
-- primary key, a saved search a unique (candidate_id, query), a membership a
-- composite key, a consultant profile a unique user_id, a company one per
-- owner. Post a listing twice and you have two listings.
--
-- The button disables while the request is in flight, which answers a double
-- click and nothing else. What it does not answer is the case the round-3
-- brief names: the client times out after the server has already committed.
-- The employer sees a failure, presses the button again, and the second
-- request is indistinguishable from a deliberate second advert — same company,
-- same title, same everything. Two listings, two credits, and the applicants
-- split between them.
--
-- A key the client generates once and repeats on every retry, unique per
-- company. The wizard makes one when it opens and keeps it for as long as the
-- form is on screen, so a retry carries the same value and lands on the
-- conflict rather than on a second insert — and saveJob answers with the
-- listing that already exists, which is what the employer meant both times.
--
-- Nullable, and unique only where present: every listing written before this
-- has no key and none of them should collide with each other.
-- =============================================================================

alter table jobs add column if not exists idempotency_key uuid;

create unique index if not exists jobs_idempotency_key_idx
  on jobs (company_id, idempotency_key)
  where idempotency_key is not null;
