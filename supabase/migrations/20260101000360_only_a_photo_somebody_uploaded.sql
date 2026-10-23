-- =============================================================================
-- 360 — Only a photo somebody uploaded
--
-- The second half of migration 339 (docs/data-lifecycle.md, item 13).
-- Signing up with Google used to copy the Google account's photo into the
-- profile; the release that carried 339 stopped doing it, and 339 cleared the
-- copies already made. The avatar guard (migration 322) still accepted a
-- googleusercontent.com URL (restated by 352, which let a local stack's
-- http://localhost storage in), because the code running before that release
-- still wrote one. Nothing writes one now (src/lib/actions/onboarding.ts), so
-- the guard accepts only a file in the account's own avatar folder, as the
-- privacy policy says: a photo is kept only if the person uploaded it.
--
-- 339's statement runs again for anybody who signed up with Google between
-- 339 being applied and that release going live: a guard judges only new
-- writes, so taking the branch out alone would leave their Google photo where
-- it is, fetched from Google by every browser that shows it.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: restate guard_profile_avatar() from migration 352; the cleared URLs were Google's copies of photos nobody uploaded here, and are not restored
-- safety: ships-with-code — the code that stopped writing Google photos merged with migration 339 (PR #33) and is live before this file is applied (merge, Vercel deploys, then pnpm db:apply); old code that still wrote one would have its Google sign-up refused at onboarding, so apply this only after that release is live

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
  -- Migration 352's guard, local stack included, less its Google branch.
  if new.avatar_url ~ ('^(https://[A-Za-z0-9.-]+|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)'
                       || '/storage/v1/object/public/avatars/'
                       || new.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
  then
    return new;
  end if;
  raise exception 'avatar_url must be a file in the account''s own avatar folder'
    using hint = 'Upload the photo through the account page.';
end;
$$;

revoke execute on function public.guard_profile_avatar() from public, anon, authenticated;

-- 339's statement, again.
update profiles
   set avatar_url = null
 where avatar_url is not null
   and public.storage_path_from_url(avatar_url, 'avatars') is null;
