-- =============================================================================
-- 73 — What a suspended account may still touch
--
-- Migration 33 made suspension take a company's listings down. It did not take
-- the company's data away from the suspended person: every policy that grants
-- an employer their applicants' names, numbers and CVs, their pipeline, their
-- notes and their documents asks one question — are you a member — and
-- membership survives suspension. The fraud case that migration describes,
-- an account collecting phone numbers behind a fake listing, kept every
-- number it had collected and could keep reading new applications to any
-- listing that stayed up because a colleague was still approved.
--
-- The membership helpers now ask a second question: is this account in good
-- standing. `pending` counts — an employer waiting for review must still be
-- able to build the company profile and upload the very documents the review
-- is waiting for (migration 16). `rejected` does not. Because every company
-- policy and every storage policy goes through these five functions, a
-- suspension now closes the console, the API and the buckets in one place.
-- =============================================================================

create or replace function public.in_good_standing()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select approval_status <> 'rejected' from profiles where id = auth.uid()),
    false);
$$;

-- Called only from inside the definer functions below, which run as their
-- owner; nothing over the API needs it directly.
revoke execute on function public.in_good_standing() from public, anon, authenticated;
grant  execute on function public.in_good_standing() to service_role;

create or replace function public.owns_company(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and exists (
    select 1 from company_members
     where company_id = target and user_id = auth.uid()
  );
$$;

create or replace function public.is_company_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and exists (
    select 1 from company_members
     where company_id = target and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.owns_job(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and exists (
    select 1 from jobs j
      join company_members m on m.company_id = j.company_id
     where j.id = target and m.user_id = auth.uid()
  );
$$;

create or replace function public.viewer_has_verified_company()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and exists (
    select 1 from company_members m
      join companies c on c.id = m.company_id
     where m.user_id = auth.uid() and c.verification_status = 'verified'
  );
$$;

create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from company_members
   where user_id = auth.uid()
     and public.in_good_standing()
   order by (role = 'admin') desc, created_at asc
   limit 1;
$$;
