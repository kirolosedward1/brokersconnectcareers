import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { looseArabicNeedle } from '@/lib/search/needle';
import type {
  AgentAvailability,
  AgentProfileRow,
  AgentVisibility,
  ApprovalStatus,
  ReportReason,
  ReportStatus,
} from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * The consultant profiles — the website's /admin/agents, read the same way:
 * every agent_profiles row whatever its visibility, with its owner's name and
 * standing (the directory hides and anonymises; an admin investigating an
 * impersonation report needs to find the profile), and one profile's page.
 * What is never read is the owner's phone or email — those are on the
 * account's file, behind a reason — nor the CV's path: the page says only
 * whether one was uploaded. Every read is an admin's alone, through the open
 * door (record.ts says why).
 */

export type AgentsView = 'all' | 'public' | 'verified_employers_only' | 'hidden' | 'restricted';

export const AGENTS_VIEWS: readonly AgentsView[] = ['all', 'public', 'verified_employers_only', 'hidden', 'restricted'];

export const AGENTS_PAGE_SIZE = 25;

/** A UUID, as the website's pages read one off the address (admin/params.ts). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AgentOwner = { id: string; full_name: string; avatar_url: string | null; approval_status: ApprovalStatus };

export type AgentListRow = {
  id: string;
  slug: string;
  years_experience: number;
  visibility: AgentVisibility;
  availability: AgentAvailability;
  restricted_at: string | null;
  created_at: string;
  profile: AgentOwner;
};

type AgentsPage = { rows: AgentListRow[]; total: number };

/** The website's VisibilityBadge: green seen by all, brand-coloured gated, outlined hidden, red restricted. */
export function visibilityVariant(visibility: AgentVisibility, restricted: boolean): 'success' | 'primary' | 'outline' | 'destructive' {
  if (restricted) return 'destructive';
  return visibility === 'public' ? 'success' : visibility === 'hidden' ? 'outline' : 'primary';
}

/** The profiles of one view, matching a search if there is one, twenty-five at a time, newest first. */
export function useAgentList(view: AgentsView, query: string) {
  const open = useOpen();
  const words = query.trim();
  return useInfiniteQuery({
    queryKey: ['admin', 'agents', view, words],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<AgentsPage> => {
      const from = (pageParam - 1) * AGENTS_PAGE_SIZE;
      let request = supabase
        .from('agent_profiles')
        .select(
          'id, slug, years_experience, visibility, availability, restricted_at, created_at, profile:profiles!inner (id, full_name, avatar_url, approval_status)',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, from + AGENTS_PAGE_SIZE - 1);

      if (view === 'restricted') request = request.not('restricted_at', 'is', null);
      else if (view !== 'all') request = request.eq('visibility', view);

      // The website's rule: either the owner's name or the slug. Two filters
      // on two tables cannot be one `or`, so a slug-shaped query is taken as a slug.
      const needle = words ? looseArabicNeedle(words) : '';
      if (needle) {
        request = /^[a-z0-9-]+$/.test(needle)
          ? request.ilike('slug', `%${needle}%`)
          : request.ilike('profile.full_name', `%${needle}%`);
      }

      const { data, error, count } = await request;
      if (error) throw error;
      const rows = (data ?? []) as unknown as AgentListRow[];
      return { rows, total: count ?? rows.length };
    },
    getNextPageParam: (last, pages) =>
      pages.length * AGENTS_PAGE_SIZE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every profile across the pages loaded so far, each once. */
export function flattenAgents(pages: AgentsPage[] | undefined): AgentListRow[] {
  const seen = new Set<string>();
  const rows: AgentListRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

export type AgentReport = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: { id: string; full_name: string } | null;
};

/** One profile as the website's page reads it, minus the CV's path: whether there is one is a fact, the file is the consultant's. */
export type AgentFile = Omit<AgentProfileRow, 'cv_path' | 'search_headline' | 'visibility_chosen_at'> & {
  profile: AgentOwner;
  developer_ids: number[];
  has_cv: boolean;
  reports: AgentReport[];
};

/** The columns the page shows: named one by one, so the CV's path is never asked for. */
const AGENT_COLUMNS =
  'id, user_id, slug, headline_ar, headline_en, years_experience, tracks, district_ids, languages, availability, visibility, summary_ar, summary_en, units_closed, volume_egp, restricted_at, restriction_reason, created_at';

export function useAgentFile(id: string | undefined) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'agent', id],
    enabled: open && Boolean(id),
    queryFn: async (): Promise<AgentFile | null> => {
      const agent = id as string;
      const read = await supabase
        .from('agent_profiles')
        .select(`${AGENT_COLUMNS}, profile:profiles (id, full_name, avatar_url, approval_status), developers:agent_developers (developer_id)`)
        .eq('id', agent)
        .maybeSingle();
      if (read.error) throw read.error;
      if (!read.data) return null;
      const { developers, ...row } = read.data as unknown as Omit<AgentFile, 'developer_ids' | 'has_cv' | 'reports'> & {
        developers: { developer_id: number }[];
      };

      const [cv, reports] = await Promise.all([
        // "CV uploaded": a count of this row with a path, never the path itself.
        supabase.from('agent_profiles').select('id', { count: 'exact', head: true }).eq('id', agent).not('cv_path', 'is', null),
        supabase
          .from('reports')
          .select('id, reason, detail, status, created_at, reporter:profiles!reports_reporter_id_fkey (id, full_name)')
          .eq('agent_id', agent)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (cv.error) throw cv.error;
      if (reports.error) throw reports.error;

      return {
        ...row,
        developer_ids: (developers ?? []).map((link) => link.developer_id),
        has_cv: (cv.count ?? 0) > 0,
        reports: (reports.data ?? []) as unknown as AgentReport[],
      };
    },
  });
}
