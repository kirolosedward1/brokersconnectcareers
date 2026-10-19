-- =============================================================================
-- 350 — my_company_id() is not for somebody signed out
--
-- Supabase's security advisor listed sixteen security-definer helpers anon
-- may execute. Fifteen stay so on purpose: every one but the two support
-- functions is read inside a row-level policy granted to public (the board's
-- jobs, the directory's cards, companies, storage), and Postgres checks
-- EXECUTE as the caller when it evaluates a policy, so revoking anon's would
-- turn a signed-out reader's browse into a permission error rather than an
-- empty answer. submit_support_request() and record_support_event() are open
-- to anon by design (migration 201): the help form is for somebody who cannot
-- sign in.
--
-- my_company_id() is in no policy and no view, and is called only by
-- signed-in code (the app's viewer, the website's actions) and by other
-- security-definer functions, which run as their owner. For anon it answers
-- null; it now cannot be called at all.
--
-- The advisor's ~70 warnings about functions authenticated may execute were
-- each read (checked 2026-10-19): every admin_* function asks admin_begin()
-- or is_admin() first, and the lifecycle report and repair ask
-- acting_as_admin(), raising 'forbidden' otherwise. Nothing changes there.
-- =============================================================================

-- rollback: grant execute on function public.my_company_id() to anon;

revoke execute on function public.my_company_id() from public, anon;
grant execute on function public.my_company_id() to authenticated, service_role;
