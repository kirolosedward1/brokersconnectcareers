/**
 * A server crash, as one log line that is safe to keep.
 *
 * Next.js prints a failed render or route with its full message, and the
 * message is whatever the code that threw put in it: a Postgres error quoting
 * the row it refused (an address, a number), a URL with its query. The error
 * page shows the reader a code — the error's digest — and support needs to go
 * from that code to the route that failed. This line is that join, by the rule
 * in observe.ts: identifiers, never content.
 *
 * - the route as a pattern (`/[locale]/jobs/[slug]`), never the path asked
 *   for, which carries slugs and query strings;
 * - the error's kind and its code (a Postgres SQLSTATE, a Node errno), not
 *   its message;
 * - the digest, the code on the reader's screen.
 *
 * No runtime imports, so scripts/crash.test.mjs runs it under Node.
 */

type Detail = Record<string, string | number | boolean | null | undefined>;

export type CrashContext = {
  routePath?: string;
  routeType?: string;
  renderSource?: string;
};

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;

export function describeCrash(error: unknown, method: string, context: CrashContext): Detail {
  const failure = (error && typeof error === 'object' ? error : {}) as {
    name?: unknown;
    code?: unknown;
    digest?: unknown;
  };
  const name = typeof failure.name === 'string' && SAFE_NAME.test(failure.name) ? failure.name : typeof error;
  const code = typeof failure.code === 'string' || typeof failure.code === 'number' ? String(failure.code) : null;
  const digest = typeof failure.digest === 'string' && SAFE_CODE.test(failure.digest) ? failure.digest : null;

  return {
    route: routePattern(context.routePath),
    type: context.routeType,
    source: context.renderSource,
    method: /^[A-Z]{3,7}$/.test(method) ? method : null,
    error: name,
    code: code && SAFE_CODE.test(code) ? code : null,
    digest,
  };
}

/**
 * The route's pattern as Next names it. Anything else — a concrete path with
 * a query, which is not what Next passes but would be the worst thing to keep
 * — is cut to the part before `?` and has every segment that is not a plain
 * word or a `[param]` replaced.
 */
function routePattern(routePath: string | undefined): string | null {
  if (!routePath) return null;
  const path = routePath.split(/[?#]/, 1)[0].slice(0, 200);
  return path
    .split('/')
    .map((segment) => (segment === '' || /^[a-z0-9_.()@-]{1,40}$/.test(segment) || /^\[{1,2}(\.\.\.)?[A-Za-z0-9_]+\]{1,2}$/.test(segment) ? segment : '[…]'))
    .join('/');
}
