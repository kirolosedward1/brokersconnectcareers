-- =============================================================================
-- 24 — Membership went one table too far
--
-- Migration 22 redefined owns_company() from "owns" to "is a member of", and
-- every policy that went through it widened at once. For listings, applicants
-- and the company logo that is exactly the point: a recruiter posts, reads
-- applications and can change the logo.
--
-- Four of them should not have widened, and I did not notice until I read back
-- what the change had actually swept in:
--
--   company_documents        the commercial register and the tax card
--   company-documents bucket the files themselves
--   orders                   what the company has been charged
--   monthly_free_post_grants the free-post ledger
--
-- A tax card carries the company's registration number. Handing it to every
-- recruiter an admin invites is not a thing anybody asked for, and it is the
-- kind of widening that is invisible precisely because it happens through a
-- function somebody else's policy calls.
--
-- Restated in full rather than patched, and only the predicate differs from
-- what migration 04 wrote — the status conditions on insert and delete are
-- carried across verbatim. Migration 16 restated a function and silently lost
-- a check that way; the fix for that is to copy the whole thing and say so,
-- not to avoid restating.
-- =============================================================================

drop policy if exists company_documents_owner  on company_documents;
drop policy if exists company_documents_insert on company_documents;
drop policy if exists company_documents_delete on company_documents;

create policy company_documents_owner on company_documents
  for select using (public.is_company_admin(company_id));

create policy company_documents_insert on company_documents
  for insert with check (public.is_company_admin(company_id) and status = 'pending');

create policy company_documents_delete on company_documents
  for delete using (public.is_company_admin(company_id) and status = 'pending');

-- The row and the file have to agree, or the row is admin-only and the PDF is
-- not. Same predicate, one level down.
drop policy if exists "owners manage their verification documents" on storage.objects;

create policy "owners manage their verification documents"
  on storage.objects for all
  using (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  );

drop policy if exists orders_select_own on orders;

create policy orders_select_own on orders
  for select using (public.is_company_admin(company_id));

drop policy if exists grants_select_own on monthly_free_post_grants;

create policy grants_select_own on monthly_free_post_grants
  for select using (public.is_company_admin(company_id));

-- The logo file, for the same reason one level down. companies.logo_url is on
-- the company record and therefore an admin's; leaving the bucket open to any
-- member let a recruiter upload a file that the row update would then refuse,
-- stranding it. The two have to agree.
drop policy if exists "owners manage their company logo" on storage.objects;

create policy "owners manage their company logo"
  on storage.objects for all
  using (
    bucket_id = 'company-logos'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'company-logos'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  );
