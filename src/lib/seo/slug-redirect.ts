/**
 * A 301 from a slug we retired to the slug that replaced it.
 *
 * Asked from middleware, through the anon key, the same way a missing listing
 * is asked. Fails open: no configuration, a timeout, or a 404 because the
 * redirect table is not there yet, and the request continues as a miss. That
 * is what makes the code safe to deploy before the migration — old slugs
 * still resolve until the rows are rewritten.
 */

const TIMEOUT_MS = 1500;
const SLUG = /^[a-z0-9-]{1,200}$/;

export async function slugRedirectTarget(
  path: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const job = path.match(/^\/jobs\/([^/]+)(\/apply)?$/);
  const company = path.match(/^\/companies\/([^/]+)$/);
  if (!job && !company) return null;

  let from: string;
  try {
    from = decodeURIComponent((job ?? company)![1]);
  } catch {
    return null;
  }
  if (!SLUG.test(from)) return null;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key || base.startsWith('REPLACE_ME') || key.startsWith('REPLACE_ME')) return null;

  const kind = job ? 'job' : 'company';
  try {
    const response = await fetcher(
      `${base}/rest/v1/slug_redirects?kind=eq.${kind}&from_slug=eq.${encodeURIComponent(from)}&select=to_slug&limit=1`,
      {
        headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    // The table is not migrated yet, or the key cannot read it. The old slug
    // still names the row, so a miss is the right answer.
    if (!response.ok) return null;
    const rows = (await response.json()) as unknown;
    const to = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' && 'to_slug' in rows[0] ? rows[0].to_slug : null;
    if (typeof to !== 'string' || !SLUG.test(to) || to === from) return null;
    return job ? `/jobs/${to}${job[2] ?? ''}` : `/companies/${to}`;
  } catch {
    return null;
  }
}
