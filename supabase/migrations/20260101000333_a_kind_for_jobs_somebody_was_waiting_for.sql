-- =============================================================================
-- 333 — A kind for the jobs somebody was waiting for
--
-- A saved search or a followed company was heard from once a week, by email
-- (the Monday digest, /api/cron/job-alerts), and only by email: a candidate
-- who reads the bell, or the app's pushes, heard nothing about a new listing
-- at all. Migration 334 writes a daily bell notification for them; this adds
-- its kind on its own, because Postgres cannot use an enum value in the
-- transaction that created it (migration 325's pattern).
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: forward-fix only — Postgres cannot remove a value from an enum; an unused value is harmless, and nothing writes this one but 334's function
-- safety: ships-with-code — safe in either order: a new kind changes nothing until the daily job writes one, and a build that does not know it shows the generic notice

alter type notification_kind add value if not exists 'new_jobs';
