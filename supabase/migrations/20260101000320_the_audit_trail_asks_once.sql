-- =============================================================================
-- 320 — The audit trail asks is_admin() once per query
--
-- Migration 314 wraps every bare argument-less helper in whatever policies
-- exist when it runs. On production that includes the two below, which have
-- been live since 2026-09-27. On a fresh database they are created later, by
-- 316, so they come out bare and every non-admin scan asks is_admin() per row.
-- This wraps them the same way. It allows exactly the same rows, and running
-- it after 314 has already wrapped them changes nothing.
-- =============================================================================

-- rollback: forward-fix only — wrapped and bare calls allow exactly the same rows, so there is nothing to undo.
-- safety: rls — alter policy only wraps is_admin() as (select public.is_admin()); who can read either table is unchanged.
-- safety: ships-with-code — no code reads how often a policy asks, so the code and this can land in either order.

alter policy admin_audit_log_select on admin_audit_log using ((select public.is_admin()));
alter policy moderation_notes_select on moderation_notes using ((select public.is_admin()));
