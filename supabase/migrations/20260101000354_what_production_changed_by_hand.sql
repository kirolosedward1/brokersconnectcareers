-- =============================================================================
-- 354 — What production changed by hand
--
-- A schema fingerprint of production (scripts/dr/fingerprint.sql, read on
-- 2026-10-16) against the database its own migration ledger builds
-- (scripts/release/rehearse.mjs) differs in two objects, and only two. Both
-- functions have the body their last migration wrote, but production runs them
-- as SECURITY INVOKER where every migration says SECURITY DEFINER, and
-- agent_card_listed_to_viewer() has lost anon's execute. The advisor lists
-- every definer function a signed-in user can call as a warning; the likeliest
-- story is that somebody answered two of those warnings in the dashboard.
--
-- One of them broke something people use:
--
--   agent_card_listed_to_viewer() is called from the reports_insert_signed_in
--   policy (migration 344) to ask "could this person see the consultant they
--   are reporting". As invoker it reads `profiles` under the reporter's own
--   row policies, and an employer can read a consultant's profile row only if
--   that consultant applied to them. So an employer who found a fake or abusive
--   card in the directory — the case the report button is for — is refused
--   with a row-level-security error. Reproduced on the test database.
--
--   admin_summary() checks is_admin() itself and every table it counts has an
--   admin read policy, so as invoker it answers the same. It goes back to what
--   the migrations say so that the next fingerprint is clean and the next
--   difference is news.
--
-- Being definer is what these functions are for: a yes/no or a count the
-- caller may have but whose inputs they may not read row by row. Each pins its
-- search_path and asks who is calling. The advisor's warning about them is
-- expected; schema.test.mjs pins which definer functions anon may call.
--
-- On a database built from the migrations this file changes nothing.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: forward-fix only — the state this replaces (invoker) was never written by any migration and refuses legitimate reports; to return to it anyway: alter function public.agent_card_listed_to_viewer(uuid) security invoker; alter function public.admin_summary() security invoker; revoke execute on function public.agent_card_listed_to_viewer(uuid) from anon;
-- safety: grant — restates migration 344's grant: anon may execute agent_card_listed_to_viewer because a row policy calls it for every caller; it answers yes or no about an id the caller already holds, and is false for anon
-- safety: revoke-anon — the revoke from public is 344's, restated; anon keeps execute on agent_card_listed_to_viewer on purpose (the grant line below), and admin_summary's revoke names anon explicitly
-- safety: ships-with-code — no code change goes with it; the website calls neither function differently

alter function public.agent_card_listed_to_viewer(uuid) security definer;
revoke execute on function public.agent_card_listed_to_viewer(uuid) from public;
grant  execute on function public.agent_card_listed_to_viewer(uuid) to anon, authenticated;

alter function public.admin_summary() security definer;
revoke execute on function public.admin_summary() from public, anon;
grant  execute on function public.admin_summary() to authenticated;
