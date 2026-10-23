import { safeNext } from '@/lib/safe-next';

/**
 * Reading an email link that carries a token hash — /auth/confirm — without a
 * framework in sight, so the website's route and the mobile app read it the
 * same way (the app opens the same link as a universal link and verifies the
 * token itself).
 *
 * The templates (scripts/auth-templates.mjs) write:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>&redirect_to={{ .RedirectTo }}
 *
 * `next` is a path on this site — the destination when the link names nothing
 * more specific (`/onboarding` for a confirmation, the new-password form for a
 * reset). `redirect_to` is last on purpose. It is the whole URL the sign-up
 * asked to come back to — itself carrying a `?next=` — and whether GoTrue
 * escapes it on the way into the email is not something to depend on. Read as
 * everything after `redirect_to=`, it survives either way: raw, its own query
 * cannot be split off by an `&`; escaped, it is decoded exactly once. When it
 * names a path here, that path wins over the template's default `next`,
 * because it carries the door's role and the page the person was opening.
 *
 * Pure: no imports but the one shared rule for what "internal" means.
 */

/** The link types GoTrue mints a token hash for, as verifyOtp names them. */
export const CONFIRM_TYPES = ['signup', 'email', 'invite', 'magiclink', 'recovery', 'email_change'] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export function asConfirmType(value: string | null | undefined): ConfirmType | null {
  return (CONFIRM_TYPES as readonly string[]).includes(String(value)) ? (value as ConfirmType) : null;
}

/**
 * A token hash as GoTrue writes it: hex, or the `pkce_`-prefixed form a
 * PKCE-initiated flow produces. Bounded, so nothing unexpected is ever sent on
 * to the auth server.
 */
export function isTokenHash(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^(pkce_)?[A-Za-z0-9_-]{16,128}$/.test(value);
}

/**
 * The rest of a query string after `name=`, decoded once if it arrived escaped
 * as a whole. Null when the parameter is absent or empty.
 *
 * For a parameter that carries a URL of its own, and is last: read this way it
 * survives every form it can arrive in — raw (its own `&` unsplit), escaped
 * once by GoTrue, or decoded and re-escaped by the framework on the way in.
 */
function tail(rawQuery: string, name: string): string | null {
  const query = rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery;
  const match = new RegExp(`(?:^|&)${name}=`).exec(query);
  if (!match) return null;

  let value = query.slice(match.index + match[0].length);
  if (!value) return null;

  // Escaped as a whole (`https%3A%2F%2F…`, or a path's `%2F…`): undo that once.
  if (/^(https?%3a|%2f)/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return value;
}

/** The `redirect_to` of a raw query string (with or without its `?`). */
export function readRedirectTo(rawQuery: string): string | null {
  return tail(rawQuery, 'redirect_to');
}

/**
 * Where to go once the link is verified, as a path on this site, or null for
 * "nowhere in particular".
 *
 * The confirmation redirect the forms build is /auth/callback?next=<path> —
 * the landing the code flow uses — so that wrapper is taken off and its `next`
 * is the destination. Any other path on this site is used as it is. Another
 * origin (the app's own scheme, somebody's site) is not somewhere this page
 * sends anyone. Whatever is left goes through safeNext, the same rule the
 * callback, the middleware and the sign-in form apply.
 */
export function landingFromRedirect(redirectTo: string | null, origin: string): string | null {
  if (!redirectTo) return null;

  let url: URL;
  let site: URL;
  try {
    site = new URL(origin);
    url = new URL(redirectTo, site);
  } catch {
    return null;
  }
  if (url.origin !== site.origin) return null;

  // The callback wrapper carries one parameter, `next`, and it is a path with
  // a query of its own — read the same way as redirect_to, for the same reason.
  const path =
    url.pathname === '/auth/callback' || url.pathname === '/auth/confirm'
      ? safeNext(tail(url.search, 'next'))
      : safeNext(`${url.pathname}${url.search}`);
  // `/` is the Site URL GoTrue falls back to when nothing was asked for: no
  // preference, as the callback treats it, rather than the marketing page.
  return path === '/' ? null : path;
}

/**
 * A `next` the link named itself, as a path on this site, or null.
 *
 * Only a relative path is allowed — `safeNext` refuses another origin, a
 * scheme and a protocol-relative URL. `/` is no preference, the same as
 * GoTrue falling back to the Site URL when the form asked for nothing.
 */
export function relativeNext(value: string | null | undefined): string | null {
  const path = safeNext(value);
  return path && path !== '/' ? path : null;
}

/**
 * Where a verified link goes: a password reset always to the form that sets
 * the new password (the session it carries is for that, whatever the link
 * says); otherwise where the link asked to go, or — when it names nowhere — an
 * email change to the account page, and anything else to wherever the sign-in
 * landing decides (null: onboarding for a new account, home otherwise).
 *
 * The redirect the form built wins when it names a path. The template's `next`
 * is the destination when that redirect names nothing (a dashboard magic link,
 * an email change that did not ask). A `next` that is not a path on this site
 * is ignored, and the default stands.
 */
export function confirmDestination(
  type: ConfirmType,
  redirectTo: string | null,
  origin: string,
  next?: string | null,
): string | null {
  if (type === 'recovery') return '/sign-in/new-password';
  const asked = landingFromRedirect(redirectTo, origin) ?? relativeNext(next);
  if (asked) return asked;
  return type === 'email_change' ? '/dashboard/account' : null;
}

/**
 * Whether the confirm page's form post came from the confirm page itself —
 * the guard against a site that posts somebody else's token hash at
 * /auth/confirm and so signs a visitor into the attacker's account.
 *
 * The browser says where a post came from: `Origin` on every POST from a
 * current browser, `Sec-Fetch-Site` beside it, both set by the browser and
 * not by the page. `Origin` naming this site is enough. It is `null` rather
 * than absent when the page's referrer policy is `no-referrer` (the Fetch
 * standard's rule), and from a sandboxed frame or a `data:` page; a null one
 * is let through only when `Sec-Fetch-Site` says the post was this site's own.
 * The confirm page sent `no-referrer` once, and every browser then posted
 * `Origin: null` — every reset, confirmation and email change link was
 * answered 403. A request with neither header (an old browser) is let
 * through, because it can only have come from a link somebody followed.
 */
export function isSameOriginPost(origin: string | null, fetchSite: string | null, ownOrigin: string): boolean {
  if (origin && origin !== 'null') return origin === ownOrigin;
  if (origin === 'null') return fetchSite === 'same-origin';
  return !fetchSite || fetchSite === 'same-origin';
}
