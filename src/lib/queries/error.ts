/**
 * Supabase returns errors as plain `{ message, details, hint, code }` objects,
 * not Error instances. Throwing one directly gives Next's overlay nothing to
 * render but `Error: {message: …, details: …}`, which says nothing about which
 * query failed or what to do — so every read path converts here instead.
 */

type SupabaseError = {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

const CONNECTION_FAILURE = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|timeout/i;

/** True when the failure is "there is no backend there", not "the query is wrong". */
function looksUnreachable(error: SupabaseError): boolean {
  return CONNECTION_FAILURE.test(`${error.message ?? ''} ${error.details ?? ''}`);
}

function setupHint(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const unconfigured = !url || url.includes('127.0.0.1') || url.includes('placeholder');

  return unconfigured
    ? 'Supabase is not configured yet. Fill NEXT_PUBLIC_SUPABASE_URL, ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local, ' +
        'run `pnpm db:push:url`, then restart the dev server. `pnpm doctor` checks all of it.'
    : `Could not reach Supabase at ${url}. Is the project paused, or the URL wrong? ` +
        'Run `pnpm doctor`.';
}

/**
 * Throws a real Error describing what failed and, where it can tell, what to do
 * about it. `context` names the read so the message points at a call site.
 */
export function raise(error: SupabaseError, context: string): never {
  if (looksUnreachable(error)) {
    throw new Error(`${context}: ${setupHint()}`, { cause: error });
  }

  const parts = [error.message?.trim()].filter(Boolean) as string[];
  if (error.code) parts.push(`(${error.code})`);
  if (error.hint?.trim()) parts.push(`— ${error.hint.trim()}`);
  if (error.details?.trim() && error.details !== error.message) {
    parts.push(`[${error.details.trim()}]`);
  }

  throw new Error(`${context}: ${parts.join(' ') || 'unknown Supabase error'}`, { cause: error });
}

/**
 * For reads a page can render without. A landing page should still tell someone
 * what the product is when the database is unreachable — losing a district list
 * is not a reason to serve a 500.
 *
 * Takes a PromiseLike rather than a Promise: Supabase's query builder is
 * thenable but not a real Promise, so it does not satisfy Promise<T>.
 */
export async function optional<T>(read: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    console.warn('[optional read failed]', error instanceof Error ? error.message : error);
    return fallback;
  }
}
