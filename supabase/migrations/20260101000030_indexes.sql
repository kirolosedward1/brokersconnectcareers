-- =============================================================================
-- 30 — Three indexes that the query patterns actually ask for
--
-- Nine foreign keys had no index leading with them. Six of them should stay
-- that way: indexing every foreign key is a habit, not a decision, and each
-- one costs write throughput and space forever.
--
-- Not indexed, deliberately:
--   company_documents.reviewed_by, reports.resolved_by — audit columns. Nothing
--     filters on them; they are read as part of a row already found by id.
--   agent_experience.district_id, companies.district_id — never filtered.
--   agent_developers.developer_id, job_developers.developer_id — junction
--     tables read in the "for this job/agent" direction, which the composite
--     primary key already serves. Nothing on the board filters by developer.
--
-- The three below are on real paths, named.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Jobs by district
--
-- The hottest filter on the site and the one with no usable index. The
-- existing jobs_facets_idx leads with track, so a district-only filter cannot
-- use it — and district-only is the common case: "وظائف في التجمع الخامس".
--
-- Three separate paths land here:
--   the board's district filter, which is `district_id in (...)`
--   the track x district landing pages
--   getSimilarJobs, which runs on every job detail page
--
-- Shaped to match how they are read rather than just the column: status is in
-- the predicate because every public query is scoped to active, and
-- published_at is in the index because every one of them orders by it, so the
-- sort comes free.
-- ---------------------------------------------------------------------------

create index if not exists jobs_district_active_idx
  on jobs (district_id, published_at desc)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Saved jobs, from the job's side
--
-- The primary key is (candidate_id, job_id), which answers "what has this
-- candidate saved" and nothing else. Deleting or expiring a job has to find
-- its saved rows, and that is a sequential scan of the whole table today.
-- Cheap to fix now and awkward to notice later, because the cost lands on a
-- cascade rather than on a page.
-- ---------------------------------------------------------------------------

create index if not exists saved_jobs_job_idx on saved_jobs (job_id);

-- ---------------------------------------------------------------------------
-- The outbox, by recipient
--
-- "Show me everything we sent this person" is the question the admin email
-- screen exists to answer, and email_log is the fastest-growing table on the
-- platform — one row per message, forever, while every other table grows per
-- user or per listing.
--
-- Partial, because a message with no user_id is one sent to an address rather
-- than to an account, and those are never looked up this way.
-- ---------------------------------------------------------------------------

create index if not exists email_log_user_idx
  on email_log (user_id, created_at desc)
  where user_id is not null;
