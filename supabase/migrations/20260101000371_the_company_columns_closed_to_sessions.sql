-- =============================================================================
-- 371 — A company's owner, credit balance and suspension reason are its own
--
-- companies_select_public is `using (true)`: the directory, the board and
-- every listing's company card read companies signed out, and that is right
-- for the name, the logo and the verification. It also handed anybody — anon
-- included, straight from PostgREST — three columns that are nobody else's:
-- owner_id (which account owns which brokerage), post_credits (what it has
-- paid for, now that billing is built) and suspension_reason (an admin's
-- words). SECURITY_REPORT.md §12 deferred it until billing; this is it.
--
-- Row-level security cannot hide a column, so this is column privileges:
-- anon and authenticated keep SELECT on every other column of companies and
-- lose it on those three. A read that names them, or asks for `*`, is now
-- "permission denied". Writes keep their table privileges and RLS (an owner
-- still inserts their company with owner_id; the guards still pin it). The
-- service role is untouched. Whoever may read the three reads them through
-- 369's functions.
--
-- apply_company_column_grants() does the revoke and the grant, so anything
-- that grants on every table afterwards (scripts/db-push.mjs on a fresh
-- branch, the test harness) can put this back by calling it. In Postgres a
-- column-level REVOKE does nothing while a table-level GRANT stands, which is
-- why the table-level SELECT goes first.
--
-- Order: 369 first; then the website deployed and the app's update published
-- (both read companies through 369's functions); then this file. Applied
-- before the code, the deployed code's select('*') on companies is refused
-- and an employer's console reads no company until the new code is live.
-- =============================================================================

-- rollback: grant select on public.companies to anon, authenticated; drop function if exists public.apply_company_column_grants();
-- safety: ships-with-code — apply only after 369 and after the website and the app's update that read companies through my_company(), my_owned_company(), admin_company() and admin_companies_owned_by() are live; before that the deployed code's select('*') on companies is refused. Public reads already name their columns (COMPANY_PUBLIC_COLUMNS), so the board, the directory and company pages are unaffected in either order

create or replace function public.apply_company_column_grants()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columns
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'companies'
     and column_name not in ('owner_id', 'post_credits', 'suspension_reason');

  revoke select on public.companies from anon, authenticated;
  execute format('grant select (%s) on public.companies to anon, authenticated', v_columns);
end;
$$;

revoke execute on function public.apply_company_column_grants() from public, anon, authenticated;

select public.apply_company_column_grants();
notify pgrst, 'reload schema';
