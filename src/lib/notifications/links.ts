/**
 * Where a notification may send its reader, and how the feed is paged.
 *
 * Pure functions, no server imports, so scripts/notifications.test.ts can run
 * them under plain Node the way the other rule modules are tested.
 *
 * ---------------------------------------------------------------------------
 * Deep links respect the reader's role
 * ---------------------------------------------------------------------------
 * The href is written into the row when the event happens, by a trigger that
 * addresses it to a candidate route or an employer route depending on who the
 * row is for. That is right on the day it is written and can stop being right:
 * a member removed from a company still holds rows pointing at its applicant
 * pages, and a row is only ever as trustworthy as whatever wrote it. So the
 * link is checked again when it is followed, against the route guards the
 * pages themselves apply (src/lib/auth.ts):
 *
 *   /employer/…            requireEmployer   employer, admin
 *   /admin/…               requireAdmin      admin
 *   /dashboard/account     requireProfile    anyone signed in
 *   /dashboard/…           requireCandidate  candidate, admin
 *   /jobs /companies /agents /notifications    anyone
 *
 * Anything else — another origin, a protocol-relative URL, a path this table
 * does not know — is refused rather than guessed at. The page's own RLS is
 * still what decides whether the particular listing is theirs; this only stops
 * a notification from sending somebody into a section that would bounce them.
 */

export type Role = 'candidate' | 'employer' | 'admin';

type Rule = { prefix: string; roles: readonly Role[] | 'any' };

// Most specific first: /dashboard/account must win over /dashboard.
const RULES: readonly Rule[] = [
  { prefix: '/dashboard/account', roles: 'any' },
  { prefix: '/dashboard', roles: ['candidate', 'admin'] },
  { prefix: '/employer', roles: ['employer', 'admin'] },
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/jobs', roles: 'any' },
  { prefix: '/companies', roles: 'any' },
  { prefix: '/agents', roles: 'any' },
  { prefix: '/notifications', roles: 'any' },
];

/** Where the feed sends somebody whose link did not survive the check. */
export const FALLBACK_HREF = '/notifications';

/**
 * The href if this reader may follow it, otherwise null.
 *
 * Locale-free by construction — the rows are written without a prefix and the
 * i18n Link adds one — so a path that already carries `/ar/` or `/en/` is not
 * one this system wrote.
 */
export function safeNotificationHref(href: string | null | undefined, role: Role): string | null {
  if (!href) return null;

  // One leading slash, then not a second one or a backslash: `//evil.test`
  // and `/\evil.test` are both read by browsers as another host.
  if (!/^\/(?![/\\])/.test(href)) return null;
  // No scheme smuggled into the path, no whitespace or control characters.
  if (/[\s\u0000-\u001f]|:/.test(href.split(/[?#]/)[0])) return null;
  if (/(^|\/)\.\.(\/|$)/.test(href)) return null;

  const path = href.split(/[?#]/)[0];
  const rule = RULES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
  if (!rule) return null;
  if (rule.roles === 'any') return href;
  return rule.roles.includes(role) ? href : null;
}

// ---------------------------------------------------------------------------
// Keyset pagination
// ---------------------------------------------------------------------------
//
// The feed is ordered (created_at desc, id desc) and paged by the last row's
// pair rather than by offset. An offset moves under the reader: a notification
// arriving between page one and page two shifts every row down by one, and
// the first row of page two is the last row of page one again. The id is the
// tie-breaker, because one trigger writing to three members stamps three rows
// with the same microsecond.

export const PAGE_SIZE = 20;

export type Cursor = { createdAt: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return `${cursor.createdAt}~${cursor.id}`;
}

/** Null for anything that is not a cursor this module wrote — the first page. */
export function decodeCursor(value: string | string[] | undefined | null): Cursor | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const at = value.lastIndexOf('~');
  if (at < 1) return null;
  const createdAt = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!UUID.test(id)) return null;
  if (Number.isNaN(Date.parse(createdAt))) return null;
  // Only characters a Postgres timestamp prints, so the value can be placed in
  // a PostgREST filter without anything in it being read as syntax.
  if (!/^[0-9T:.+\- Z]+$/.test(createdAt)) return null;
  return { createdAt, id };
}

/**
 * The PostgREST `or` filter for "strictly after this cursor" in the feed's
 * order. Quoted, because a timestamp carries `:` and `.` and an `or` tree
 * treats a few characters as structure.
 */
export function afterCursorFilter(cursor: Cursor): string {
  const at = `"${cursor.createdAt}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id})`;
}
