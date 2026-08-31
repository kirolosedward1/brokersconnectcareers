-- =============================================================================
-- 07 — Function hardening
--
-- Two findings from Supabase's database linter, triaged rather than blanket
-- applied.
--
-- 1. FIXED — trigger functions had a mutable search_path. They are SECURITY
--    INVOKER and every cross-schema call inside them is already schema
--    qualified, so this is defence in depth rather than a live hole, but it
--    costs nothing.
--
-- 2. NOT FIXED, deliberately — the linter also flags the RLS helpers
--    (is_admin, owns_company, owns_job, my_company_id, current_role_of_user,
--    viewer_has_verified_company) as SECURITY DEFINER functions callable by
--    anon and authenticated.
--
--    Revoking EXECUTE on them breaks every policy that calls them. Postgres
--    evaluates an RLS policy expression with the *caller's* privileges, so the
--    caller needs EXECUTE on any function the policy invokes. Tried it: the
--    policy suite went from 46 passing to 11 failing with "permission denied
--    for function owns_company". See supabase/tests/policies.test.mjs.
--
--    The exposure is acceptable because each helper reports only on the
--    caller's own state — "am I an admin", "do I own this company" — and
--    returns nothing about anyone else. An anonymous caller gets false from
--    every one of them.
--
--    The four functions the application genuinely calls over RPC keep their
--    grants too: search_agents, get_agent_card, increment_job_view and
--    claim_monthly_free_post. Those gate internally rather than relying on the
--    caller's role.
-- =============================================================================

alter function public.stamp_job_publication()    set search_path = public;
alter function public.enforce_active_post_cap()  set search_path = public;
alter function public.guard_company_update()     set search_path = public;
alter function public.guard_job_update()         set search_path = public;
alter function public.guard_application_update() set search_path = public;
alter function public.guard_profile_update()     set search_path = public;

-- Trigger functions fire from the table, never from the API, so nothing needs
-- to call these directly. Postgres runs a trigger function with the privileges
-- of the statement's user but does not require EXECUTE on it, so revoking here
-- is safe — again, the policy suite is the proof.
revoke execute on function public.stamp_job_publication()    from public, anon, authenticated;
revoke execute on function public.enforce_active_post_cap()  from public, anon, authenticated;
revoke execute on function public.guard_company_update()     from public, anon, authenticated;
revoke execute on function public.guard_job_update()         from public, anon, authenticated;
revoke execute on function public.guard_application_update() from public, anon, authenticated;
revoke execute on function public.guard_profile_update()     from public, anon, authenticated;
