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
-- safety: ships-with-code — the value is unused until 362, and nothing in the old server writes this label. Apply 361 and 362 while that server is live (it still deletes, and 362 leaves the delete in place), deploy #75, then apply 363. The new server calls withdraw_application and, while that function is missing, reports withdrawal unavailable and does not delete the row. This file only adds an unused label

alter type public.application_status add value if not exists 'withdrawn';
