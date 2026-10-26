import { safeNext } from '@/lib/safe-next';

/**
 * Where `/welcome` and `/mfa` go on the website.
 *
 * The app has both as screens. The website's home is the welcome, and the
 * account page is where a code is entered, so these URLs redirect there.
 * The destination never points back at `/welcome` or `/mfa`, for a signed-in
 * reader or a signed-out one: a permanent redirect only where the target does
 * not depend on the session.
 */
export type EntryRedirect = { href: string; status: 307 | 308 };

const ENTRY_PATHS = ['/welcome', '/mfa', '/sign-in'];

/** A `next` that would send the reader back through one of these doors is dropped. */
function entryNext(value: string | null): string | null {
  const next = safeNext(value);
  if (!next) return null;
  const path = next.split(/[?#]/, 1)[0] || '/';
  if (ENTRY_PATHS.some((door) => path === door || path.startsWith(`${door}/`))) return null;
  return next;
}

function signIn(next: string): string {
  return `/sign-in?${new URLSearchParams({ next }).toString()}`;
}

function challenge(next: string | null): string {
  const params = new URLSearchParams({ mfa: 'challenge' });
  if (next) params.set('next', next);
  return `/dashboard/account?${params.toString()}`;
}

/**
 * The redirect for an entry path, or null when this request is not one.
 *
 * `/welcome` is always the home page, permanently: the same place for
 * everybody, so a cache cannot send a signed-in reader and a signed-out one
 * to different doors.
 *
 * `/mfa` depends on the session, so it is temporary and not cached.
 * Signed out, sign-in, then the page they were going to (the account, when
 * they named none) — the account page itself asks for the code when one is
 * due, and the middleware asks on the way into any other page. Signed in and
 * the code is due, straight to that challenge. Signed in and it is not, the
 * page they named, or the account. `then=new-password` is the reset form.
 */
export function redirectForEntry(
  path: string,
  search: string,
  signedIn: boolean,
  secondFactorDue: boolean,
): EntryRedirect | null {
  if (path === '/welcome') {
    const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
    return { href: `/${query}`, status: 308 };
  }

  if (path !== '/mfa') return null;

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const after = params.get('then') === 'new-password' ? '/sign-in/new-password' : entryNext(params.get('next'));

  if (!signedIn) {
    return { href: signIn(after ?? '/dashboard/account'), status: 307 };
  }
  if (secondFactorDue) {
    return { href: challenge(after), status: 307 };
  }
  return { href: after ?? '/dashboard/account', status: 307 };
}
