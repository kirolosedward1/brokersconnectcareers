/*
  The landing-slug parser is passed in, so the test suite can run this file
  with the real parser from lib/taxonomy.ts. Ended-or-not is job-state's
  question; the test registers the `@/` alias before loading this file.
*/
import { displayJobStatus } from '@/lib/job-state';
import type { JobStatus } from '@/lib/supabase/database.types';
type ParseLanding = (slug: string) => { districtSlug: string } | null;

/**
 * Whether the record behind a public detail URL exists for this reader —
 * asked before the page renders, so a missing one can be a real 404.
 *
 * The detail routes stream: each has a loading.tsx, so the 200 is on the wire
 * before the page learns its record is missing, and notFound() can only draw
 * the not-found UI under that 200. Google calls that a soft 404. It never
 * indexes these (they carry noindex), but a listing that was rejected, a
 * company taken down with a suspension, or a mistyped share link should drop
 * out on the first recrawl with the status that says so, not linger as a
 * Search Console warning. The same status is what a signed-in reader gets:
 * the page's own notFound() cannot change a status that has already been sent.
 *
 * One indexed lookup through the REST API. With no session it uses the anon
 * key; with a session it uses that token, so row-level security answers as
 * it answers the page. An expired listing is `gone` (410), one closed by its
 * owner still exists (it keeps its page, noindexed), and a draft exists only
 * for a reader the policies let through.
 *
 * A consultant card the reader may not open at all — a candidate opening a
 * colleague's address — is `unknown`, not `missing`. The page redirects them.
 * Calling that a 404 would tell them the profile is absent.
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

const JOB_STATUSES = ['draft', 'pending_review', 'active', 'expired', 'closed', 'rejected'] as const satisfies readonly JobStatus[];

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

/**
 * A job row as the public API returned it. No status means "there", not
 * "gone" — the existence check used to ask only whether a row came back.
 *
 * Ended or not is displayJobStatus's question. An unparseable date is not a
 * closed window: it is left off, and a stored `expired` still reads as gone.
 */
export function jobAvailability(row: unknown): 'exists' | 'gone' {
  if (!row || typeof row !== 'object') return 'exists';
  const status = 'status' in row ? row.status : undefined;
  const expires = 'expires_at' in row ? row.expires_at : undefined;
  if (!isJobStatus(status)) return 'exists';
  const parsed = typeof expires === 'string' && expires.length > 0 ? new Date(expires).getTime() : Number.NaN;
  const expiresAt = typeof expires === 'string' && expires.length > 0 && !Number.isNaN(parsed) ? expires : null;
  return displayJobStatus({ status, expires_at: expiresAt }) === 'expired' ? 'gone' : 'exists';
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
  // The same function the page asks. The argument is the handle: a slug, or
  // the id a locked card is opened by. Anon cannot call it; a signed-in
  // reader can, and an empty answer is "no card for you", which is not always
  // "no such profile".
  return [{ rpc: 'get_agent_card', arg: 'p_handle', value: slug }];
}

/**
 * Which records a path could name — any one existing means the page exists —
 * or null when it is not a detail page. `/jobs/<slug>/apply` names the same
 * listing as the page it belongs to, so an expired one can answer 410 there
 * too instead of streaming a soft 404.
 */
function authHeaders(key: string, accessToken: string | null): Record<string, string> {
  return {
    apikey: key,
    authorization: `Bearer ${accessToken || key}`,
    accept: 'application/json',
  };
}

async function readJson(
  url: string,
  key: string,
  accessToken: string | null,
  fetcher: typeof fetch,
): Promise<unknown | null> {
  const response = await fetcher(url, {
    headers: authHeaders(key, accessToken),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

/**
 * No card, for a reader who is allowed to open one, is a missing profile.
 * No card for anyone else is not: the page sends them to their own console
 * instead of a 404, and a 404 would say the address was empty.
 */
async function agentCardState(
  handle: string,
  base: string,
  key: string,
  accessToken: string | null,
  fetcher: typeof fetch,
): Promise<RecordState> {
  try {
    const rows = await readJson(
      `${base}/rest/v1/rpc/get_agent_card?p_handle=${encodeURIComponent(handle)}&select=id`,
      key,
      accessToken,
      fetcher,
    );
    if (!Array.isArray(rows)) return 'unknown';
    if (rows.length) return 'exists';
    if (!accessToken) return 'missing';

    const allowed = await readJson(`${base}/rest/v1/rpc/can_browse_agent_directory`, key, accessToken, fetcher);
    return allowed === true ? 'missing' : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function lookup(
  target: Target,
  base: string,
  key: string,
  accessToken: string | null,
  fetcher: typeof fetch,
): Promise<RecordState> {
  if ('rpc' in target) return agentCardState(target.value, base, key, accessToken, fetcher);

  try {
    const rows = await readJson(
      `${base}/rest/v1/${target.table}?select=${target.table === 'jobs' ? 'status,expires_at' : target.column}&${target.column}=eq.${encodeURIComponent(target.value)}&limit=1`,
      key,
      accessToken,
      fetcher,
    );
    if (!Array.isArray(rows)) return 'unknown';
    if (!rows.length) return 'missing';
    return target.table === 'jobs' ? jobAvailability(rows[0]) : 'exists';
  } catch {
    return 'unknown';
  }
}

export async function recordState(
  path: string,
  parseLandingSlug: ParseLanding,
  fetcher: typeof fetch = fetch,
  accessToken: string | null = null,
): Promise<RecordState> {
  const targets = detailTargets(path, parseLandingSlug);
  if (!targets) return 'unknown';

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key || base.startsWith('REPLACE_ME') || key.startsWith('REPLACE_ME')) return 'unknown';

  // A live page wins: a landing whose slug is also an expired listing is the
  // landing. Gone only when a listing has run out and nothing else is there.
  // Missing only when every candidate is definitely missing.
  const answers = await Promise.all(
    targets.map((target) => lookup(target, base, key, accessToken, fetcher)),
  );
  if (answers.includes('exists')) return 'exists';
  if (answers.includes('gone')) return 'gone';
  if (answers.includes('unknown')) return 'unknown';
  return 'missing';
}
