import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminAuditRow } from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * The audit log — the website's /admin/audit: every decision an admin took,
 * newest first, fifty at a time, from the append-only admin_audit_log (nobody
 * can edit or delete a row, the service role included: migration 316). Read
 * as the admin, under the policy the website's page reads it, and only
 * through the open door: the table answers an admin at aal1 with no rows at
 * all, which must never be drawn as "no decisions yet".
 *
 * The filters are the website's: a type (one kind of target, or `direct` —
 * changes made through the API rather than a lever, each worth a second look
 * because it skipped the transition rules and the reason), one actor, or one
 * target.
 */
export const AUDIT_TYPES = ['all', 'user', 'company', 'job', 'agent', 'application', 'taxonomy', 'direct'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_PAGE_SIZE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The type a link names (`?type=` on /admin/audit), or every decision. */
export function auditTypeOf(value: string | undefined): AuditType {
  return (AUDIT_TYPES as readonly string[]).includes(value ?? '') ? (value as AuditType) : 'all';
}

/** An actor filter is a user id; anything else in the address filters nothing (the website's UUID_RE). */
export function auditActorOf(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value : undefined;
}

/** A target filter is any id the table holds (a uuid, or a taxonomy row's number). */
export function auditTargetOf(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id ? id : undefined;
}

export type AuditFilter = { type: AuditType; actor?: string; target?: string };

type AuditPage = { rows: AdminAuditRow[]; total: number };

export function useAuditLog({ type, actor, target }: AuditFilter) {
  const open = useOpen();
  return useInfiniteQuery({
    queryKey: ['admin', 'audit', type, actor ?? null, target ?? null],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<AuditPage> => {
      const from = (pageParam - 1) * AUDIT_PAGE_SIZE;
      let query = supabase
        .from('admin_audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + AUDIT_PAGE_SIZE - 1);
      if (type === 'direct') query = query.eq('via', 'direct');
      else if (type !== 'all') query = query.eq('target_type', type);
      if (actor) query = query.eq('actor_id', actor);
      if (target) query = query.eq('target_id', target);

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = (data ?? []) as AdminAuditRow[];
      return { rows, total: count ?? rows.length };
    },
    getNextPageParam: (last, pages) =>
      pages.length * AUDIT_PAGE_SIZE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every entry across the pages loaded so far, each once. */
export function flattenAudit(pages: AuditPage[] | undefined): AdminAuditRow[] {
  const seen = new Set<number>();
  const rows: AdminAuditRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** The status move an entry recorded (`from → to`), or the columns a direct edit touched: the one line of metadata worth reading. */
export function auditChange(row: Pick<AdminAuditRow, 'metadata'>): string | null {
  const m = (row.metadata ?? {}) as { from?: unknown; to?: unknown; columns?: unknown };
  if (typeof m.from === 'string' && typeof m.to === 'string') return `${m.from} → ${m.to}`;
  if (Array.isArray(m.columns)) return m.columns.join(', ');
  return null;
}
