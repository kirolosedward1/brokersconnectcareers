/*
  A member's own view of their company.

  Renumbered from 20260101000356_a_members_own_view_of_their_company.sql,
  then from 20260101000366_a_members_own_view_of_their_company.sql. Main's
  newest applied migration is 365 (english_slugs_and_redirects); 364 is on
  main too. 366 is the saved-listing reminder. This file is 367.

  my_company_id() already leaves out a removed member and a suspended one,
  so this migration does not redefine it. company_members has no status
  column (migration 22): leaving a company deletes the row, and a row that
  is not there is not a member. A suspended member is a profile whose
  approval_status is 'rejected'; my_company_id() (migration 308) only
  returns a company_members row when in_good_standing() is true, and that
  helper is approval_status <> 'rejected'. A pending member still counts.
  A suspended company is a different thing: companies.suspended_at does
  not drop the member, and my_company_id() still names that company so
  my_company_private() can return the suspension.

  companies is readable by everyone: the directory policy is `using (true)`,
  and a select of the row therefore returns every column, including the
  owner, the credit balance and whether an admin has suspended the company.
  The billing screen, the company page, delete-account, the applicants
  pages and the standing notice all need those three, and they were reading
  them off that public row.

  my_company_private() answers them for the company my_company_id() names —
  a member in good standing, so an invited recruiter has them too — and
  answers null for everybody else. It takes no argument: there is no company
  id to pass, and nothing to ask about a company that is not the caller's.

  The grants on companies are unchanged. Revoking select on those columns
  from anon and authenticated can follow once this function is what the app
  and the website call; doing it here would break the code already running,
  which still reads the columns off the row, and the admin queues, which
  still read suspended_at under the admin policy.

  company_suspended() is the one public question that remains: the company
  page hides a suspended company, and it has to keep doing that after the
  column itself is not selectable. It answers a boolean and nothing else.
*/

-- rollback: drop function if exists public.my_company_private(); drop function if exists public.company_suspended(uuid);
-- safety: ships-with-code — companies' grants are unchanged, so the app and website already running keep reading owner_id, post_credits and suspended_at off the row. This code calls my_company_private() and, until that function exists (PGRST202 or 42883), reads those three columns directly, which the current grants still allow. The company page calls company_suspended() and, until that exists, reads suspended_at off the row the same way. Neither order revokes a privilege or changes a policy.
-- safety: grant — company_suspended(uuid) tells a signed-out reader only whether one company is suspended, which the public company page already reads off the row, so that page can keep hiding one after the column is not selectable. It returns no owner and no balance.

create or replace function public.my_company_private()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'owner_id', c.owner_id,
    'post_credits', c.post_credits,
    'suspended_at', c.suspended_at
  )
  from public.companies c
  where c.id = public.my_company_id();
$$;

comment on function public.my_company_private() is
  'The caller''s company, and only a member''s: owner, post credits, and whether it is suspended. Null for everybody else.';

revoke execute on function public.my_company_private() from public, anon;
grant execute on function public.my_company_private() to authenticated, service_role;

create or replace function public.company_suspended(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.companies
     where id = p_id and suspended_at is not null
  );
$$;

comment on function public.company_suspended(uuid) is
  'Whether a company is suspended. A boolean, so the public page can hide one without the column being readable.';

revoke execute on function public.company_suspended(uuid) from public, anon;
grant execute on function public.company_suspended(uuid) to anon, authenticated, service_role;
