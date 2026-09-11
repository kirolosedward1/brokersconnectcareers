/**
 * Where a reader came from, kept only as long as the visit.
 *
 * In this market a listing spreads by being forwarded into a WhatsApp group,
 * and that arrival is invisible: the referrer on a WhatsApp forward is empty,
 * so every one of them lands in analytics as direct traffic indistinguishable
 * from somebody typing the address. The share button appends `?src=share`, and
 * this is what reads it.
 *
 * Kept in sessionStorage rather than counted on arrival and forgotten, because
 * the number worth having is not how many people a share reached — it is how
 * many of them applied, and that happens two navigations later. The analytics
 * file says the business is two ratios; this makes the third measurable.
 *
 * Session-scoped on purpose. It answers "did this visit begin with a share",
 * and a visit is exactly the right lifetime for that: it disappears when the
 * tab does, it never follows anyone between sessions, and it holds one short
 * word about a click rather than anything about a person.
 */

const KEY = 'bc.src';

/** The values a `?src=` is allowed to be. Anything else is somebody guessing. */
const KNOWN = ['share'] as const;
export type ShareSource = (typeof KNOWN)[number];

function isKnown(value: string | null): value is ShareSource {
  return value !== null && (KNOWN as readonly string[]).includes(value);
}

/**
 * Reads `?src=` from the current URL, remembers it, and takes it back out of
 * the address bar.
 *
 * Removed because the parameter has done its job the moment it is read, and
 * leaving it there means the next person to copy the address shares a URL that
 * claims to be a share of a share. `replaceState` rather than a router
 * navigation: nothing on the page needs to change, and a navigation here would
 * cost a re-render and the reader's scroll position.
 */
export function rememberShareArrival(): ShareSource | null {
  if (typeof window === 'undefined') return null;

  try {
    const url = new URL(window.location.href);
    const src = url.searchParams.get('src');
    if (!isKnown(src)) return null;

    sessionStorage.setItem(KEY, src);

    url.searchParams.delete('src');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

    return src;
  } catch {
    // A private window, or storage the browser refuses. Attribution is not
    // worth an exception on a page somebody is trying to read.
    return null;
  }
}

/** What this visit began with, if anything. */
export function shareSource(): ShareSource | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = sessionStorage.getItem(KEY);
    return isKnown(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The same URL with `?src=share` on it, for the share sheet to carry.
 *
 * Appended rather than replacing the query, so a listing shared from a
 * filtered board keeps whatever brought the sharer to it.
 */
export function withShareSource(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.set('src', 'share');
    return url.toString();
  } catch {
    return href;
  }
}
