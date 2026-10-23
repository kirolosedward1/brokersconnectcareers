import { useQuery } from '@tanstack/react-query';
import type { AdminSearchKind, AdminSearchRow, AuditTargetType } from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * The console's one search box — the website's /admin/search: "somebody
 * wrote to support about X". admin_search finds names and titles by
 * fragment, accounts by exact email or phone digits (returning neither), and
 * anything by its id; six of each kind at most, because this finds a thing
 * to open, it is not a list to scroll. Nothing is asked until there are two
 * characters to ask with (the function answers nothing for fewer), and the
 * words are cut where the website's parsers cut them.
 */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 120;
export const SEARCH_PER_KIND = 6;

/** The kinds in the order the website lists them. */
export const SEARCH_KINDS: readonly AdminSearchKind[] = ['user', 'company', 'job', 'agent', 'application'];

/** The words as they are sent: trimmed, and no longer than the website takes. */
export function searchNeedle(query: string): string {
  return query.trim().slice(0, SEARCH_MAX);
}

export function useAdminSearch(query: string) {
  const open = useOpen();
  const needle = searchNeedle(query);
  return useQuery({
    queryKey: ['admin', 'search', needle],
    enabled: open && needle.length >= SEARCH_MIN,
    queryFn: async (): Promise<AdminSearchRow[]> => {
      const { data, error } = await supabase.rpc('admin_search', { p_query: needle });
      if (error) throw error;
      return (data ?? []) as AdminSearchRow[];
    },
  });
}

export type SearchGroup = { kind: AdminSearchKind; rows: AdminSearchRow[] };

/** The results by kind, in the website's order, six of each at most, the empty kinds left out. */
export function groupResults(rows: AdminSearchRow[]): SearchGroup[] {
  return SEARCH_KINDS.map((kind) => ({ kind, rows: rows.filter((row) => row.kind === kind).slice(0, SEARCH_PER_KIND) })).filter(
    (group) => group.rows.length > 0,
  );
}

/**
 * Where each kind of thing is in the console — the website's own paths, which
 * the app routes natively (links.ts). A report has no page of its own.
 */
export function consolePath(kind: AdminSearchKind | AuditTargetType, id: string): string | null {
  switch (kind) {
    case 'user':
      return `/admin/users/${id}`;
    case 'company':
      return `/admin/companies/${id}`;
    case 'job':
      return `/admin/jobs/${id}`;
    case 'agent':
      return `/admin/agents/${id}`;
    case 'application':
      return `/admin/applications/${id}`;
    case 'taxonomy':
      return '/admin/taxonomy';
    default:
      return null;
  }
}
