/*
  No imports: the landing-slug parser is passed in, so the test suite can run
  this file directly with the real parser from lib/taxonomy.ts.
*/
type ParseLanding = (slug: string) => { districtSlug: string } | null;

/**
 * Whether the record behind a public detail URL exists for an anonymous
 * visitor — asked before the page renders, so a missing one can be a real 404.
 *
 * The detail routes stream: each has a loading.tsx, so the 200 is on the wire
 * before the page learns its record is missing, and notFound() can only draw
 * the not-found UI under that 200. Google calls that a soft 404. It never
 * indexes these (they carry noindex), but a listing that was rejected, a
 * company taken down with a suspension, or a mistyped share link should drop
 * out on the first recrawl with the status that says so, not linger as a
 * Search Console warning.
 *
 * One indexed lookup through the public REST API with the anon key, so
 * row-level security answers exactly as it answers the page: an expired
 * listing is `gone` (410), one closed by its owner still exists (it keeps
 * its page, noindexed), a draft, a listing in review or a rejected one
 * does not, and a consultant profile exists unless it is hidden.
 *
 * Fails open. Anything but a clean answer — no configuration, a timeout, an
 * error status — is 'unknown', and the request goes through to the page,
 * which still handles a missing record the way it always has.
 *
 * A listing that has run out (`expired`, or still labelled active after
 * `expires_at`) is `gone`: the middleware answers 410 before the page
 * streams. Closed by its owner is still `exists` — that page stays, with
 * its closed notice. A row with no status (an older answer) is `exists`,
 * never `gone`: a wrong 410 hides a live listing.
 */
export type RecordState = 'exists' | 'missing' | 'unknown' | 'gone';

const TIMEOUT_MS = 1500;

type Target = { table: string; column: string; value: string } | { rpc: string; arg: string; value: string };

/** The internal page an expired listing is drawn on, or null when `path` is not a job URL. */
export function goneRewritePath(locale: string, path: string): string | null {
  const match = path.match(/^\/jobs\/([^/]+)(?:\/apply)?$/);
  if (!match) return null;
  return `/${locale}/gone/jobs/${match[1]}`;
}

function readSlug(raw: string): string | null {
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!slug || slug.length > 200) return null;
  return slug;
}

/**
 * A job row as the public API returned it. No status means "there", not
 * "gone" — the existence check used to ask only whether a row came back.
 */
export function jobAvailability(row: unknown): 'exists' | 'gone' {
  if (!row || typeof row !== 'object') return 'exists';
  const status = 'status' in row ? row.status : undefined;
  const expires = 'expires_at' in row ? row.expires_at : undefined;
  if (status === 'expired') return 'gone';
  if (status === 'active' && typeof expires === 'string' && expires.length > 0) {
    const at = new Date(expires).getTime();
    if (!Number.isNaN(at) && at <= Date.now()) return 'gone';
  }
  return 'exists';
}

export function detailTargets(path: string, parseLandingSlug: ParseLanding): Target[] | null {
  const apply = path.match(/^\/jobs\/([^/]+)\/apply$/);
  if (apply) {
    const slug = readSlug(apply[1]);
    return slug ? [{ table: 'jobs', column: 'slug', value: slug }] : null;
  }

  const match = path.match(/^\/(jobs|companies|agents)\/([^/]+)$/);
  if (!match) return null;
  const [, section, raw] = match;
  const slug = readSlug(raw);
  if (!slug) return null;

  if (section === 'jobs') {
    const job: Target = { table: 'jobs', column: 'slug', value: slug };
    /*
      Landing-shaped is not the same as a landing page. A listing's slug is
      its title, so "commercial-consultant-nasr-city-890956" starts with a
      track and parses as the commercial page for a district called
      "consultant-nasr-city-890956". The page tries the district and falls
      back to the listing; this has to ask about both, or a real listing
      with an unlucky title answers 404.
    */
    const landing = parseLandingSlug(slug);
    return landing ? [{ table: 'districts', column: 'slug', value: landing.districtSlug }, job] : [job];
  }
  if (section === 'companies') return [{ table: 'companies', column: 'slug', value: slug }];
  // Gated profiles are invisible to anon under RLS but still have a page
  // (anonymised), so ask the same function the page asks.
  return [{ rpc: 'get_agent_card', arg: 'p_slug', value: slug }];
}

/**
 * Which records a path could name — any one existing means the page exists —
 * or null when it is not a detail page. `/jobs/<slug>/apply` names the same
 * listing as the page it belongs to, so an expired one can answer 410 there
 * too instead of streaming a soft 404.
 */
async function lookup(target: Target, base: string, key: string, fetcher: typeof fetch): Promise<RecordState> {
  const url =
    'rpc' in target
      ? `${base}/rest/v1/rpc/${target.rpc}?${target.arg}=${encodeURIComponent(target.value)}&select=id`
      : `${base}/rest/v1/${target.table}?select=${target.table === 'jobs' ? 'status,expires_at' : target.column}&${target.column}=eq.${encodeURIComponent(target.value)}&limit=1`;

  try {
    const response = await fetcher(url, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return 'unknown';
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) return 'unknown';
    if (!rows.length) return 'missing';
    return !('rpc' in target) && target.table === 'jobs' ? jobAvailability(rows[0]) : 'exists';
  } catch {
    return 'unknown';
  }
}

export async function recordState(
  path: string,
  parseLandingSlug: ParseLanding,
  fetcher: typeof fetch = fetch,
): Promise<RecordState> {
  const targets = detailTargets(path, parseLandingSlug);
  if (!targets) return 'unknown';

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key || base.startsWith('REPLACE_ME') || key.startsWith('REPLACE_ME')) return 'unknown';

  // A live page wins: a landing whose slug is also an expired listing is the
  // landing. Gone only when a listing has run out and nothing else is there.
  // Missing only when every candidate is definitely missing.
  const answers = await Promise.all(targets.map((target) => lookup(target, base, key, fetcher)));
  if (answers.includes('exists')) return 'exists';
  if (answers.includes('gone')) return 'gone';
  if (answers.includes('unknown')) return 'unknown';
  return 'missing';
}
