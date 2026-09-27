/**
 * Which avatar URLs the site will actually fetch.
 *
 * `profiles.avatar_url` is drawn as an <img> in every employer's browser: the
 * applicant card, the shortlist, the directory card, the profile page. The
 * database trigger (migration 202) pins the *shape* of the value — the
 * account's own folder in the avatars bucket, or a Google account picture —
 * but it cannot know this deployment's storage host, so a URL with the right
 * path on somebody else's host still passes it. Rendered as it stands, that
 * is a tracking pixel: a candidate learns the IP address and the moment an
 * employer opened their application.
 *
 * So the host is pinned here, where it is known. Only the app's own Supabase
 * storage and Google's picture host are fetched; anything else falls back to
 * the monogram, which is what a missing photo looks like anyway.
 *
 * No imports, so the auth suite can load it under Node.
 */
const GOOGLE_PICTURES = 'lh3.googleusercontent.com';
const AVATARS_PATH = '/storage/v1/object/public/avatars/';

export function trustedAvatarUrl(
  url: string | null | undefined,
  storageOrigin: string | null | undefined,
): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  if (parsed.protocol === 'https:' && parsed.host === GOOGLE_PICTURES) return url;

  if (!storageOrigin) return null;
  let own: URL;
  try {
    own = new URL(storageOrigin);
  } catch {
    return null;
  }

  return parsed.origin === own.origin && parsed.pathname.startsWith(AVATARS_PATH) ? url : null;
}
