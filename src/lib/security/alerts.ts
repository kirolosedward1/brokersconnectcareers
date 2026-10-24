/**
 * What a security alert and the weekly digest say, as email blocks.
 *
 * Pure: the watcher (api/cron/security-watch) reads the rows and the numbers,
 * notify.ts addresses and sends, and this decides the words — so the tests
 * can hold what an admin is told without a database or a mailer.
 *
 * Identifiers, never content: security_events.metadata holds ids by design
 * (migration 303), and an alert names the event's kind, its time, and the
 * account behind it by id. Whoever reads it opens /admin/security for more.
 */
import type { emailCopy } from '@/lib/email/copy';
import type { Block } from '@/lib/email/components';

type Copy = (typeof emailCopy)['ar' | 'en'];

export type SecurityEventRow = {
  id: number;
  kind: string;
  created_at: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
};

export type SecurityDigest = {
  days: number;
  auth_failures: number;
  rate_limited: number;
  uploads_rejected: number;
  critical: number;
  warnings: number;
  reveals: number;
  reveals_by_company: { company: string; count: number }[];
  new_admins: { at: string; name: string | null; path: string | null }[];
  admins_now: number;
};

/** Cairo's clock, Western digits: what an admin in Egypt reads the time in. */
function cairo(at: string, locale: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB-u-nu-latn' : 'ar-EG-u-nu-latn', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(at));
}

export function alertBlocks(event: SecurityEventRow, c: Copy, locale: 'ar' | 'en', siteUrl: string): Block[] {
  const t = c.securityAlert;
  const path = typeof event.metadata?.path === 'string' ? event.metadata.path : null;
  const rows: [string, string][] = [
    [t.labelKind, event.kind],
    [t.labelAt, cairo(event.created_at, locale)],
    [t.labelActor, event.actor_id ?? t.nobody],
  ];
  if (path) rows.push([t.labelPath, path === 'direct' ? t.direct : t.session]);
  return [
    { kind: 'security', value: event.kind === 'account.made_admin' ? t.madeAdmin : t.body },
    { kind: 'facts', rows },
    { kind: 'button', label: t.cta, href: `${siteUrl}/admin/security` },
  ];
}

export function digestBlocks(digest: SecurityDigest, c: Copy, siteUrl: string): Block[] {
  const t = c.securityDigest;
  const blocks: Block[] = [
    {
      kind: 'facts',
      rows: [
        [t.labelAuth, String(digest.auth_failures)],
        [t.labelRate, String(digest.rate_limited)],
        [t.labelUploads, String(digest.uploads_rejected)],
        [t.labelCritical, String(digest.critical)],
        [t.labelReveals, String(digest.reveals)],
        [t.labelAdmins, String(digest.admins_now)],
      ],
    },
  ];
  if (digest.reveals_by_company.length) {
    blocks.push({ kind: 'text', value: t.topCompanies });
    blocks.push({ kind: 'facts', rows: digest.reveals_by_company.map((row) => [row.company, String(row.count)]) });
  }
  blocks.push({
    kind: digest.new_admins.length ? 'security' : 'text',
    value: digest.new_admins.length ? t.newAdmins(digest.new_admins.length) : t.noNewAdmins,
  });
  blocks.push({ kind: 'text', value: t.firewall });
  blocks.push({ kind: 'button', label: t.cta, href: `${siteUrl}/admin/security` });
  return blocks;
}

/** The ISO week a digest belongs to (2026-W43), so a rerun the same week sends nothing new. */
export function isoWeek(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
