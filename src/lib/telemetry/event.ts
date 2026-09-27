import { scrubDetail, scrubText, type Detail } from './scrub';

/**
 * One shape for everything the platform records about something going wrong.
 *
 *   server_error  an exception nothing caught: a page, a route handler or a
 *                 server action threw. Captured by instrumentation.ts.
 *   client_error  the same in a browser: an uncaught error, a rejected promise
 *                 nobody awaited, or an error boundary that had to render.
 *   failure       something the product tried to do and did not — an
 *                 application refused, an upload rejected, a sign-in that
 *                 failed, an email the provider would not take. Not a crash,
 *                 and usually handled on screen; counted because a rate of
 *                 them is how a broken flow shows up before anybody reports it.
 *
 * `area` is the subsystem (`apply`, `auth.sign_in`, `upload.avatars`,
 * `render`), `event` is what did not happen in the product's own words.
 * Everything else is context that is safe to keep: never content.
 */
export type OpsKind = 'server_error' | 'client_error' | 'failure';
export type OpsLevel = 'error' | 'warning' | 'info';

export type OpsEventInput = {
  kind: OpsKind;
  level?: OpsLevel;
  area: string;
  event: string;
  /** Error class, e.g. TypeError. */
  name?: string | null;
  message?: string | null;
  /** Top frames only, scrubbed. Never stored in the database. */
  stack?: string | null;
  route?: string | null;
  role?: string | null;
  /** Next's error digest: the code a reader sees on the error screen. */
  digest?: string | null;
  /** The platform's request id (x-vercel-id), when there is one. */
  request?: string | null;
  release?: string | null;
  environment?: string | null;
  detail?: Record<string, unknown> | null;
};

export type OpsEvent = {
  kind: OpsKind;
  level: OpsLevel;
  area: string;
  event: string;
  fingerprint: string;
  name: string;
  message: string;
  stack: string;
  route: string;
  role: string;
  digest: string;
  request: string;
  release: string;
  environment: string;
  detail: Detail;
};

const KINDS: readonly OpsKind[] = ['server_error', 'client_error', 'failure'];
const LEVELS: readonly OpsLevel[] = ['error', 'warning', 'info'];

/** A label that can be grouped on: short, lower-case, no free text. */
function label(value: unknown, fallback: string, max = 60): string {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:/ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return cleaned || fallback;
}

function token(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[^\w.:-]/g, '')
    .slice(0, max);
}

/**
 * The part of a message that stays the same when the same bug fires again.
 * Ids, numbers and long quoted values vary per occurrence; grouping on them
 * would give every occurrence its own row.
 */
export function messageShape(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/(["'`])(?:(?!\1).){25,}\1/g, '<s>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * FNV-1a, twice with different offsets, for a 64-bit-wide hex key. Not for
 * security — for grouping, where it only has to be stable across processes
 * and runtimes (node, edge, browser), which a dependency-free hash is.
 */
function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function fingerprintOf(parts: string[]): string {
  const joined = parts.join('|');
  return `${fnv1a(joined, 0x811c9dc5)}${fnv1a(joined, 0x2166136a)}`;
}

/**
 * Validates, bounds and scrubs an event, and gives it the key it is grouped
 * under. Safe to call on anything — a browser payload included — and never
 * throws.
 */
export function finalizeEvent(input: OpsEventInput): OpsEvent {
  const kind = KINDS.includes(input.kind) ? input.kind : 'client_error';
  const level = input.level && LEVELS.includes(input.level) ? input.level : kind === 'failure' ? 'warning' : 'error';
  const area = label(input.area, 'unknown', 40);
  const event = label(input.event, 'unknown', 80);
  const name = token(input.name, 60);
  const message = scrubText(input.message, 500);

  return {
    kind,
    level,
    area,
    event,
    // The route is deliberately not part of the key: one broken component
    // fails on every page that renders it, and that is one bug, not twelve.
    fingerprint: fingerprintOf([kind, area, event, name, messageShape(message)]),
    name,
    message,
    stack: scrubText(input.stack, 800),
    route: scrubText(input.route, 120),
    role: label(input.role, 'unknown', 20),
    digest: token(input.digest, 40),
    request: token(input.request, 100),
    release: token(input.release, 40) || 'unknown',
    environment: label(input.environment, 'unknown', 20),
    detail: scrubDetail(input.detail ?? undefined),
  };
}

/**
 * The one line a captured event leaves in the platform log.
 *
 * JSON, so a log drain can index it and `"ops":"server_error"` finds every
 * capture in the Vercel log search. The stack goes here and only here: it is
 * what a person reading one occurrence needs, and what an aggregate row does
 * not.
 */
export function logLine(event: OpsEvent): string {
  const { detail, stack, kind, ...rest } = event;
  // Detail first so a caller's key can never overwrite a field of the event.
  const line: Record<string, unknown> = { ops: kind, ...detail, ...rest };
  line.ops = kind;
  if (stack) line.stack = stack;
  for (const key of Object.keys(line)) {
    if (line[key] === '' || line[key] === 'unknown') delete line[key];
  }
  return JSON.stringify(line);
}
