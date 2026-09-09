/** Anything a URL parser might strip, reorder, or treat as a terminator. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Where a sign-in is allowed to send somebody afterwards.
 *
 * `?next=` is attacker-controllable — it is a query parameter on a page that
 * anybody can link to — so it decides a redirect and must be validated before
 * it is used. Today the value happens to be neutralised downstream by
 * accident: next-intl's router treats it as a pathname, so
 * `?next=https://evil.example` lands on `/arhttps:/evil.example` and 404s
 * rather than leaving the site. That is the router's string handling, not a
 * defence, and it stops being true the moment anyone reaches for
 * `location.assign` or the router changes. This is the defence.
 *
 * It also fixes the honest half of the same problem: a `next` that cannot be
 * used should return somebody to a page that exists, not to a 404 built out of
 * their own query string.
 *
 * Internal paths only. No scheme, no host, no protocol-relative `//`, and no
 * backslashes — several browsers normalise `\` to `/`, so `/\evil.example`
 * is a protocol-relative URL wearing a disguise.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  // Written as escapes rather than literal bytes: the same check with real
  // control characters in the source renders as `/[ -]/`, which reads like a
  // space-or-hyphen class and is one careless edit from becoming one.
  if (CONTROL.test(raw)) return null;

  // Percent-encoding can hide any of the above from the checks written here —
  // `/%2f%2fevil.example` is `//evil.example` by the time a browser reads it.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed escape is not something to guess at.
    return null;
  }
  // Every rule again, on the decoded form. `/%2f%2fevil.example` is
  // `//evil.example` by the time a browser reads it, and `/%09/evil.example`
  // is a path with a tab in it — which some parsers strip, turning it into the
  // protocol-relative URL the first check was looking for.
  if (decoded.startsWith('//') || decoded.includes('\\')) return null;
  if (CONTROL.test(decoded)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;

  return raw;
}

/**
 * The same value with the locale prefix removed.
 *
 * The middleware records where somebody was going as a full request path, and
 * that path carries `/en` when they were reading the English site. next-intl's
 * router adds the prefix again on the way back, so handing it the prefixed
 * form produces `/en/en/dashboard`. Latent while English is unpublished, and
 * wrong the day it is turned on.
 */
export function stripLocalePrefix(path: string, locales: readonly string[]): string {
  for (const locale of locales) {
    if (path === `/${locale}`) return '/';
    if (path.startsWith(`/${locale}/`)) return path.slice(locale.length + 1);
  }
  return path;
}
