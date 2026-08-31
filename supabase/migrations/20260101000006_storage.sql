-- =============================================================================
-- 06 — Storage buckets
--
-- Path conventions:
--   company-logos/{company_id}/{file}      public
--   company-documents/{company_id}/{file}  private, owner + admin
--   cvs/{user_id}/{file}                   private, owner only
--
-- Employers never get a storage policy on `cvs`. They receive a short-lived
-- signed URL minted server-side, and only after we have checked that the CV
-- belongs to someone who applied to a job they own.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('company-logos', 'company-logos', true, 2097152,
   array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('company-documents', 'company-documents', false, 10485760,
   array['image/png','image/jpeg','application/pdf']),
  ('cvs', 'cvs', false, 10485760,
   array['application/pdf','application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- company-logos
-- ---------------------------------------------------------------------------

create policy "company logos are world readable"
  on storage.objects for select
  using (bucket_id = 'company-logos');

create policy "owners manage their company logo"
  on storage.objects for all
  using (
    bucket_id = 'company-logos'
    and public.owns_company((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'company-logos'
    and public.owns_company((storage.foldername(name))[1]::uuid)
  );

-- ---------------------------------------------------------------------------
-- company-documents — never public, never listed.
-- ---------------------------------------------------------------------------

create policy "owners manage their verification documents"
  on storage.objects for all
  using (
    bucket_id = 'company-documents'
    and public.owns_company((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'company-documents'
    and public.owns_company((storage.foldername(name))[1]::uuid)
  );

create policy "admins read verification documents"
  on storage.objects for select
  using (bucket_id = 'company-documents' and public.is_admin());

-- ---------------------------------------------------------------------------
-- cvs — owner only.
-- ---------------------------------------------------------------------------

create policy "candidates manage their own cv"
  on storage.objects for all
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins read cvs"
  on storage.objects for select
  using (bucket_id = 'cvs' and public.is_admin());
