-- =============================================================================
-- 369 — Whoever may read a company whole gets it from a function that asks
--
-- The first half of taking owner_id, post_credits and suspension_reason out
-- of companies_select_public (SECURITY_REPORT.md §12; 371 is the second
-- half). Row-level security cannot hide a column, so 371 uses column
-- privileges, and every reader entitled to those columns needs another way
-- in first. These are it, each a definer function that asks before it
-- answers:
--
--   my_company()                  the caller's company (my_company_id(): a
--                                 member in good standing), the whole row
--   my_owned_company()            the company the caller owns, the whole row
--   admin_company(id)             any company, for an admin (is_admin())
--   admin_companies_owned_by(ids) which company each account owns, for an admin
--
-- Additive: nothing reads them until the code that does is deployed, and the
-- code that does needs them to exist. So: apply 369, deploy the website and
-- publish the app's update, then apply 371.
-- =============================================================================

-- rollback: drop function if exists public.my_company(), public.my_owned_company(), public.admin_company(uuid), public.admin_companies_owned_by(uuid[]);
-- safety: ships-with-code — additive: four new functions nobody calls until the code that calls them is deployed, and that code needs them, so this applies first; nothing is revoked here (371 does that, after the code)
-- safety: definer — each function pins search_path, answers only the caller's own company, the company they own, or (is_admin(), else forbidden) an admin's request, and is not executable by anon

create or replace function public.my_company()
returns setof companies
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.* from companies c where c.id = public.my_company_id();
$$;

create or replace function public.my_owned_company()
returns setof companies
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.* from companies c where c.owner_id = auth.uid();
$$;

create or replace function public.admin_company(p_company uuid)
returns setof companies
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Refused out loud, as every other admin_* function is, not answered empty.
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return query select c.* from companies c where c.id = p_company;
end;
$$;

create or replace function public.admin_companies_owned_by(p_users uuid[])
returns table (id uuid, name_ar text, owner_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return query
    select c.id, c.name_ar, c.owner_id from companies c
     where c.owner_id = any (p_users)
     limit 500;
end;
$$;

revoke execute on function public.my_company(), public.my_owned_company(),
  public.admin_company(uuid), public.admin_companies_owned_by(uuid[]) from public, anon;
grant execute on function public.my_company(), public.my_owned_company(),
  public.admin_company(uuid), public.admin_companies_owned_by(uuid[]) to authenticated;

notify pgrst, 'reload schema';
