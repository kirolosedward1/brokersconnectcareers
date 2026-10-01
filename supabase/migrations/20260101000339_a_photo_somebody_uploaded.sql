-- =============================================================================
-- 339 — A photo somebody uploaded
--
-- Signing up with Google used to copy the Google account's photo into the
-- profile. This release's onboarding stops doing that, and the privacy policy
-- says the Google photo is not made the profile picture — but a profile
-- imported before still shows it (one on production on 2026-10-01), and every
-- page that shows it has the reader's browser fetch an image from Google.
--
-- So a photo that is not a file in our avatar storage is cleared. Its owner
-- sees their initials until they upload a photo of their choosing. Nothing is
-- queued for deletion: the cleared URLs are not files in our storage
-- (storage_path_from_url answers null for them).
--
-- Not here: migration 322's guard still accepts a googleusercontent.com URL,
-- because the code running before this release still writes one at
-- onboarding, and refusing it would break that sign-up until the new code is
-- live. Take that branch out in the next release (docs/data-lifecycle.md).
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: none — the cleared URLs were Google's copies of photos the people they showed never uploaded here, and are not restored
-- safety: ships-with-code — only clears data: old code draws initials for a profile with no photo exactly as the new code does, and if old code imports a Google photo for a new sign-up after this runs, the next release's guard change (or this statement run again) clears it; nothing is refused

update profiles
   set avatar_url = null
 where avatar_url is not null
   and public.storage_path_from_url(avatar_url, 'avatars') is null;
