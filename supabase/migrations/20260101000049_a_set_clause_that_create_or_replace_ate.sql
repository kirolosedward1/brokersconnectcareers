-- =============================================================================
-- 49 — What `create or replace` takes away besides the body
--
-- Migration 07 set `search_path = public` on six trigger functions and revoked
-- EXECUTE on them from public, anon and authenticated. Migration 46 restated
-- stamp_job_publication to fix the repost window and did not carry the SET
-- clause across — and CREATE OR REPLACE resets every function attribute the
-- new statement does not repeat, so the hardening went with the old body.
-- Migration 16's comment warns about exactly this for checks inside a guard;
-- it is true of the attributes outside one too.
--
-- The revoke survived, because grants are held against the function's identity
-- rather than its definition. So the damage was one function running with a
-- mutable search_path — it is SECURITY INVOKER, which makes that much less
-- than it would be on a definer function, and still not a thing to leave.
--
-- And record_application_event, added in migration 42, never had the second
-- half. It is the only trigger function in the schema still executable by
-- PUBLIC. Calling a trigger function directly raises "trigger functions can
-- only be called as triggers", so nothing is reachable through it; the point
-- is that a rule kept for fifteen functions and not the sixteenth stops being
-- a rule. The schema suite asserts both properties for every trigger function
-- from here, so the next one cannot be forgotten quietly.
-- =============================================================================

alter function public.stamp_job_publication() set search_path = public;

revoke execute on function public.record_application_event() from public, anon, authenticated;
