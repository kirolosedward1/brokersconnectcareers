-- =============================================================================
-- 35 — Somewhere for a profile photo to live
--
-- `profiles.avatar_url` has been read since the first migration: the console
-- header, the applicant card, the team list, the directory card and the public
-- consultant page all draw it. Exactly one thing has ever written it — the
-- onboarding action, copying whatever Google supplied — so an account created
-- with an email address had no photo and no way to acquire one, ever. Fifteen
-- profiles on the platform, none with an avatar.
--
-- Same shape as company-logos, which had the same gap and closed it: public
-- bucket, folder per owner, a policy that checks the folder is theirs.
--
-- No SVG, for the reason migration 26 gives at length: an SVG is a document
-- that can carry script, and these are uploaded by anybody who signs up.
-- 2 MB, because this is drawn at 64px at its largest.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars are world readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- The folder is the account's own id, which is the whole of the rule: a
-- signed-in person may write inside their own folder and nowhere else.
create policy "people manage their own avatar"
  on storage.objects for all
  using (
    bucket_id = 'avatars'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );
