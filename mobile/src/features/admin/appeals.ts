import { useInfiniteQuery } from '@tanstack/react-query';
import { oneOf } from '@/lib/admin/params';
import type { AppealRow, AppealSubjectType } from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * Appeals — the website's /admin/appeals: one message about one decision,
 * and one answer (migration 328), read from moderation_appeals with the
 * appellant's and the decider's names, under the admin's own session and
 * only through the open door. Waiting ones oldest first, because the person
 * waiting longest has been without their listing, company or account
 * longest; answered ones newest answer first. Twenty a page, as the website.
 */

export const APPEAL_VIEWS = ['open', 'decided'] as const;
export type AppealView = (typeof APPEAL_VIEWS)[number];

export const APPEALS_PAGE = 20;

export type Appeal = AppealRow & {
  appellant: { id: string; full_name: string } | null;
  decider: { full_name: string } | null;
};

type AppealsPage = { rows: Appeal[]; total: number };

/** The view a link asks for (`?status=decided`), held to the two there are. */
export function readAppealView(status: string | string[] | undefined): AppealView {
  const text = Array.isArray(status) ? status[0] : status;
  return oneOf(text?.trim(), APPEAL_VIEWS, 'open');
}

export function useAppeals(view: AppealView) {
  const open = useOpen();
  return useInfiniteQuery({
    queryKey: ['admin', 'appeals', view],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<AppealsPage> => {
      const from = (pageParam - 1) * APPEALS_PAGE;
      let query = supabase
        .from('moderation_appeals')
        .select(
          `*, appellant:profiles!moderation_appeals_appellant_id_fkey (id, full_name),
          decider:profiles!moderation_appeals_decided_by_fkey (full_name)`,
          { count: 'exact' },
        );
      query =
        view === 'open'
          ? query.eq('status', 'open').order('created_at', { ascending: true })
          : query.neq('status', 'open').order('decided_at', { ascending: false });
      const { data, error, count } = await query.order('id').range(from, from + APPEALS_PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Appeal[];
      return { rows, total: count ?? rows.length };
    },
    getNextPageParam: (last, pages) =>
      pages.length * APPEALS_PAGE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every appeal across the pages loaded so far, each once. */
export function flattenAppeals(pages: AppealsPage[] | undefined): Appeal[] {
  const seen = new Set<string>();
  const out: Appeal[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/** The website's path for what an appeal is about: each a native screen of the console. */
export function subjectPath(type: AppealSubjectType, id: string): string {
  switch (type) {
    case 'job':
      return `/admin/jobs/${id}`;
    case 'company':
      return `/admin/companies/${id}`;
    case 'account':
      return `/admin/users/${id}`;
    case 'agent':
      return `/admin/agents/${id}`;
  }
}
