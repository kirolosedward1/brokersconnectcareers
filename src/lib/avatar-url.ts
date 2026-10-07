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
const LOGOS_PATH = '/storage/v1/object/public/company-logos/';

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

  return fromOwnStorage(parsed, storageOrigin, AVATARS_PATH) ? url : null;
}

/**
 * Which company logos the site and the app will fetch: this deployment's own
 * storage, the logos bucket, and nothing else.
 *
 * `companies.logo_url` is drawn on every card of the board, the company page,
 * the app's lists and the company's own emails. Migration 344 pins its path
 * to the company's folder, but like the avatar trigger it cannot know this
 * deployment's host — a company admin writing the column straight through
 * the API could put the same path on a tracker's host, and learn who scrolls
 * the board and when. Anything else is the company's initial, as when there
 * is no logo.
 */
export function trustedLogoUrl(url: string | null | undefined, storageOrigin: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return fromOwnStorage(parsed, storageOrigin, LOGOS_PATH) ? url : null;
}

function fromOwnStorage(parsed: URL, storageOrigin: string | null | undefined, path: string): boolean {
  if (!storageOrigin) return false;
  let own: URL;
  try {
    own = new URL(storageOrigin);
  } catch {
    return false;
  }
  return parsed.origin === own.origin && parsed.pathname.startsWith(path);
}
