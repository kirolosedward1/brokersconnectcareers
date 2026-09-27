/**
 * What may leave the browser, and in what shape.
 *
 * Isomorphic on purpose: the client runtime uses it before anything is sent,
 * the metrics route uses it again on arrival, and the tests read it directly.
 * A rule that lives in one place cannot drift between the three.
 *
 * The rule is the one src/lib/observe.ts already keeps for the logs: shapes
 * and categories, never content. A URL here can carry a person — a
 * consultant's slug is built from their name, and /unsubscribe carries a
 * token — so a provider is never handed a raw address.
 */

/** Values that look like somebody rather than a category. */
const PERSONAL = [
  /@/, // an email address
  /\+?\d[\d\s-]{6,}\d/, // a phone number: seven digits or more
  /https?:\/\//i, // a URL, which can carry any of the above
];

export function looksPersonal(value: string): boolean {
  return PERSONAL.some((pattern) => pattern.test(value));
}

/**
 * Software rather than a reader.
 *
 * Link-preview fetchers are the ones that matter here: every forward of a
 * listing into a WhatsApp group makes WhatsApp fetch it once, and that fetch
 * was being counted as a view. An empty user agent is treated as automated
 * too — no browser sends one.
 */
export const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|skype|discord|embedly|headless|lighthouse|pingdom|uptime|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|httpclient|scrapy|phantom|puppeteer|playwright/i;

export function isAutomatedAgent(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT_PATTERN.test(userAgent);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path with the people taken out of it.
 *
 * `/agents/<slug>` becomes `/agents/[slug]` because the slug is the
 * consultant's name — on a card the consultant set to anonymous, the URL would
 * otherwise say who it is. Row ids become `[id]`: they identify nothing to a
 * provider and only split one console page into hundreds.
 */
export function redactPath(pathname: string): string {
  const parts = pathname.split('/');
  const redacted = parts.map((part, index) => {
    if (UUID.test(part)) return '[id]';
    if (part && parts[index - 1] === 'agents') return '[slug]';
    return part;
  });
  return redacted.join('/') || '/';
}

/**
 * Campaign attribution survives; nothing else in a query string does.
 *
 * `q` is whatever somebody typed into a search box, `token` unsubscribes an
 * inbox, `next` is a private path. The utm set is what a provider needs to say
 * which campaign a visit came from, and none of it is about the visitor.
 */
const KEPT_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'source'];

export function redactUrl(href: string): string | null {
  try {
    const url = new URL(href);
    const kept = new URLSearchParams();
    for (const key of KEPT_PARAMS) {
      const value = url.searchParams.get(key);
      if (value && value.length <= 64 && !looksPersonal(value)) kept.set(key, value);
    }
    const query = kept.toString();
    // No fragment, ever: Supabase's implicit flow puts a session there.
    return `${url.origin}${redactPath(url.pathname)}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

/**
 * Where a visit came from, at the resolution a provider needs.
 *
 * Our own pages are redacted like any other URL; somebody else's are cut to
 * the origin, because another site's path and query are that site's business
 * and can carry that site's users.
 */
export function redactReferrer(referrer: string, origin: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return url.origin === origin ? redactUrl(referrer) : `${url.origin}/`;
  } catch {
    return null;
  }
}
