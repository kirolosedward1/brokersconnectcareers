-- =============================================================================
-- 361 — Withdrawn is a status
--
-- A candidate who withdraws used to delete the row. The next file keeps it,
-- marked withdrawn, and this one only adds the label. A new enum value cannot
-- be used in the transaction that adds it, so the column, the index and the
-- function wait for 362.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the
-- code over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: forward-fix only — PostgreSQL cannot drop a single enum value; to undo, leave 'withdrawn' unused
-- safety: ships-with-code — the value is unused until 362. The website still withdraws by deleting until withdraw_application exists, and nothing in the old server writes this label. Applied after the new server, that server still deletes when the function is missing (PGRST202) and only then calls it

alter type public.application_status add value if not exists 'withdrawn';
