-- =============================================================================
-- 381 — Who revealed a number
--
-- docs/design/v1.1/phase-b/10 (Revealing a contact; Privacy). Two reads over
-- the reveal ledger (migration 304), which is kept 90 days (338):
--
--   my_company_revealed(handle)  when the caller's company last revealed this
--                                consultant's number, for «كشف سابق» on the
--                                confirmation. The company could not read the
--                                ledger at all.
--   my_contact_reveals(limit)    the consultant's own log: which companies
--                                revealed their number and when. Company
--                                names only: who on the team pressed the
--                                button is the company's (its activity log,
--                                migration 377), not the consultant's.
--
-- Tested in supabase/tests/reveal-reads.test.mjs.
--
-- rollback: drop function if exists public.my_company_revealed(text), public.my_contact_reveals(int);
-- safety: additive — two read-only functions.
-- safety: ships-with-code — two new read functions called only by new app code, which treats an
--   error as "nothing to say"; either order leaves running code as it is.
-- =============================================================================

create or replace function public.my_company_revealed(p_handle text)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select max(r.created_at)
    from agent_contact_reveals r
    join agent_profiles a on a.id = r.agent_id
   where a.slug = p_handle
     and r.company_id = public.my_company_id()
     and public.owns_company(r.company_id);
$$;

revoke execute on function public.my_company_revealed(text) from public, anon;
grant execute on function public.my_company_revealed(text) to authenticated, service_role;

create or replace function public.my_contact_reveals(p_limit int default 100)
returns table (revealed_at timestamptz, company_name_ar text, company_name_en text, company_slug text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.created_at, c.name_ar, c.name_en, c.slug
    from agent_contact_reveals r
    join agent_profiles a on a.id = r.agent_id
    left join companies c on c.id = r.company_id
   where a.user_id = auth.uid()
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke execute on function public.my_contact_reveals(int) from public, anon;
grant execute on function public.my_contact_reveals(int) to authenticated, service_role;
