-- =============================================================================
-- 300 — is_admin() asked once per query, and the home page's counts in one read
--
-- Numbered 300 so it sorts after every migration in flight on other branches:
-- the first half rewrites whatever policies exist when it runs, so running last
-- is the point, and nothing below depends on anything newer than 068.
--
-- ONE. Migration 57 wrapped `auth.uid()` as `(select auth.uid())` so Postgres
-- computes it once instead of once per row, and stopped there. Thirty-odd
-- policies still call `is_admin()` bare — every `*_admin_all` policy, plus
-- profiles_select_self and company_members'. Postgres ORs every permissive
-- policy together, so for somebody who is not an admin the filter on those
-- tables reads `<their own rows> OR is_admin()`, and is_admin() — a SECURITY
-- DEFINER lookup in profiles — runs for every row the scan tests.
--
-- Measured on the load-test dataset (460,000 notifications, 143,000
-- applications — a year of a 10,000-user board), as a candidate, with the
-- page's own explicit filter taken away to isolate the policy:
--
--   unread-count for the bell      157 ms, 176,662 buffers  ->  2.5 ms, 115
--   the bell's latest six          554 ms, 668,771 buffers  ->   76 ms, 116,249
--
-- Same semantics: is_admin() takes no arguments and is STABLE, so asking it
-- once per statement answers exactly what asking it per row did. The same goes
-- for the other argument-less helpers below; the row-dependent ones (owns_job,
-- owns_company, applied_to_my_job …) are left alone, because they genuinely
-- depend on the row and cannot be hoisted.
--
-- This is the safety net, not the fix. The fix is what migration 57 already
-- said: a page that knows whose rows it wants says so, so the planner has an
-- index to use — the bell, the dashboard and the board's applied/saved marks
-- now do. This makes the next page that forgets far cheaper to have forgotten.
--
-- Written as a loop over pg_policies rather than restated policy by policy, so
-- it catches policies that other branches' migrations create before this one
-- runs, and running it twice changes nothing: an already-wrapped call reads
-- `( SELECT is_admin() AS is_admin)` and is not matched again.
-- =============================================================================

do $$
declare
  p record;
  helpers constant text := '(is_admin|viewer_has_verified_company|is_candidate|is_approved_employer|acting_as_admin|current_role_of_user)';
  -- A bare call: not already the argument of a SELECT, optionally schema-qualified.
  -- Both lookbehinds, so neither `SELECT is_admin()` nor `SELECT public.is_admin()`
  -- is matched again. Group 1 is the optional schema, group 2 the helper's name.
  bare constant text := '(?<!SELECT )(?<!SELECT public\.)\m(public\.)?' || helpers || '\(\)';
  new_qual text;
  new_check text;
  changed int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ bare or coalesce(with_check, '') ~ bare)
  loop
    new_qual := regexp_replace(p.qual, bare, '(select public.\2())', 'g');
    new_check := regexp_replace(p.with_check, bare, '(select public.\2())', 'g');

    if p.qual is not null and p.with_check is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                     p.policyname, p.schemaname, p.tablename, new_qual, new_check);
    elsif p.qual is not null then
      execute format('alter policy %I on %I.%I using (%s)',
                     p.policyname, p.schemaname, p.tablename, new_qual);
    else
      execute format('alter policy %I on %I.%I with check (%s)',
                     p.policyname, p.schemaname, p.tablename, new_check);
    end if;
    changed := changed + 1;
  end loop;

  raise notice 'wrapped argument-less helper calls in % policies', changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- TWO. Everything the home page's browse module counts, grouped by the database.
--
-- getBrowseCounts() read every live listing — track, district and company type
-- — a thousand rows per request, and counted them in JavaScript: at 3,000 live
-- listings, three sequential round trips and 235 KB out of the database on
-- every visit to the home page and the board. That grows with the board, and
-- on the Free plan database egress is a quota (5 GB a month), not a price.
--
-- This returns the same numbers already grouped: one row per track x district
-- x company type that has a live listing — a few hundred at most, however large
-- the board gets.
--
-- SECURITY INVOKER on purpose. The counts are a claim about what a reader will
-- find when they click, so they are computed under the reader's own row-level
-- security, exactly as the old read was: the anonymous client counts what
-- anybody may see and nothing else. The predicates are the board's.
-- -----------------------------------------------------------------------------

create or replace function public.browse_counts()
returns table (track job_track, district_id integer, company_type text, listings bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select j.track, j.district_id, c.company_type, count(*)
    from jobs j
    join companies c on c.id = j.company_id
   where j.status = 'active'
     and j.expires_at > now()
   group by j.track, j.district_id, c.company_type
$$;

-- Said outright rather than left to Supabase's default privileges: the home
-- page calls this signed out, so anon needs it, and it is invoker-rights, so
-- the grant opens nothing a direct read of jobs does not already.
revoke execute on function public.browse_counts() from public;
grant execute on function public.browse_counts() to anon, authenticated, service_role;
