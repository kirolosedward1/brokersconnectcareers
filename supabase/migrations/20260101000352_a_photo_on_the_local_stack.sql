-- =============================================================================
-- 352 — A photo on the local stack
--
-- The avatar and logo guards (322, 344) take a picture's address only when it
-- starts `https://`. A local Supabase stack serves storage at
-- `http://127.0.0.1:54321` (or `http://localhost:54321`), so on one every
-- profile photo and every company logo the upload action wrote was refused at
-- the profile or company update: the action removed the file again and
-- answered `failed`. Nobody could see either feature working in local
-- development, and the end-to-end run (.github/workflows/e2e.yml, which starts
-- that stack) could not cover them — scripts/e2e/edge-journeys.mjs found it.
--
-- Migration 307 already made this allowance in the columns' own CHECKs
-- (`http://` to localhost or 127.0.0.1 only); the guards now make the same
-- one, and nothing else changes. Everything after the host is still pinned:
-- the storage path, the bucket, and the account's or company's own folder.
-- What the website and the app draw is still decided by trustedAvatarUrl and
-- trustedLogoUrl (src/lib/avatar-url.ts), which accept only this deployment's
-- own storage origin, so production — whose storage origin is https — draws
-- nothing new. Tested in supabase/tests/doors.test.mjs.
--
-- Compatibility: the guards accept a superset of what they accepted, and no
-- code reads them, so either order with the code, and a rollback, are safe.
-- =============================================================================

-- rollback: restate guard_profile_avatar() from migration 322 and guard_company_logo() from migration 344
-- safety: ships-with-code — the src/ change on this branch (the email-link confirm page) does not touch photos, logos or these guards, and the guards only accept more than before; either order is safe

create or replace function public.guard_profile_avatar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;
  if new.avatar_url is null then return new; end if;
  if tg_op = 'UPDATE' and new.avatar_url is not distinct from old.avatar_url then
    return new;
  end if;
  if new.avatar_url ~ ('^(https://[A-Za-z0-9.-]+|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)'
                       || '/storage/v1/object/public/avatars/'
                       || new.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
     or new.avatar_url ~ '^https://[a-z0-9.-]*googleusercontent\.com/[A-Za-z0-9._~%/=-]+$'
  then
    return new;
  end if;
  raise exception 'avatar_url must be a file in the account''s own avatar folder'
    using hint = 'Upload the photo through the account page.';
end;
$$;

revoke execute on function public.guard_profile_avatar() from public, anon, authenticated;

create or replace function public.guard_company_logo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;
  if new.logo_url is null then return new; end if;
  if tg_op = 'UPDATE' and new.logo_url is not distinct from old.logo_url then
    return new;
  end if;
  -- What the upload action writes: the storage's public address of a file it
  -- re-encoded into this company's folder. The app draws logos straight from
  -- this address on every card, so anything else would be a third party told
  -- who is scrolling the board — or another company's logo.
  if new.logo_url ~ ('^(https://[A-Za-z0-9.-]+|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)'
                     || '/storage/v1/object/public/company-logos/'
                     || new.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$') then
    return new;
  end if;
  raise exception 'logo_url must be a file in the company''s own logo folder'
    using hint = 'Upload the logo through the company page.';
end;
$$;

revoke execute on function public.guard_company_logo() from public, anon, authenticated;
