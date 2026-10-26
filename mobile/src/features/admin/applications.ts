import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { looseArabicNeedle } from '@/lib/search/needle';
import type { ApplicationStatus, ApprovalStatus, ExperienceBand, JobStatus, UserRole } from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { UUID } from './agents';
import { useOpen } from './record';

/**
 * Applications, for investigating — the website's /admin/applications, read
 * the same way and, like it, with no lever: moving an application is the
 * employer's decision and withdrawing it the candidate's. What an admin
 * needs is to see what happened — when it was sent, whether it was opened,
 * who moved it and when. Never the CV: nothing about a dispute over process
 * needs the document, and the website serves it to the two parties alone.
 * The employer's private notes are counted, not read. Every read is an
 * admin's alone, through the open door (record.ts says why).
 */

export type ApplicationsView = 'all' | 'unopened' | 'new' | 'shortlisted' | 'interview' | 'hired' | 'rejected';

export const APPLICATIONS_VIEWS: readonly ApplicationsView[] = ['all', 'unopened', 'new', 'shortlisted', 'interview', 'hired', 'rejected'];

export const APPLICATIONS_PAGE_SIZE = 25;

/** How long "nobody looked" takes to become the complaint support receives. */
const UNOPENED_AFTER_MS = 7 * 86_400_000;

export type ApplicationListRow = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  employer_viewed_at: string | null;
  job: { id: string; title_ar: string; title_en: string | null; company: { name_ar: string; name_en: string | null } | null };
  candidate: { id: string; full_name: string } | null;
};

type ApplicationsPage = { rows: ApplicationListRow[]; total: number };

/** One listing's, or one candidate's, applications — a link's `?job=` / `?candidate=`. Anything but a UUID is no filter. */
export type ApplicationsFilter = { job?: string; candidate?: string };

/** The applications of one view, matching a search and a filter if there are any, twenty-five at a time. */
export function useApplicationList(view: ApplicationsView, query: string, filter: ApplicationsFilter) {
  const open = useOpen();
  const words = query.trim();
  const job = filter.job && UUID.test(filter.job) ? filter.job : null;
  const candidate = filter.candidate && UUID.test(filter.candidate) ? filter.candidate : null;
  return useInfiniteQuery({
    queryKey: ['admin', 'applications', view, words, job, candidate],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<ApplicationsPage> => {
      const from = (pageParam - 1) * APPLICATIONS_PAGE_SIZE;
      let request = supabase
        .from('applications')
        .select(
          'id, status, created_at, employer_viewed_at, job:jobs!inner (id, title_ar, title_en, company:companies (name_ar, name_en)), candidate:profiles!inner (id, full_name)',
          { count: 'exact' },
        )
        // The oldest unopened first: that is the queue of people nobody answered.
        .order('created_at', { ascending: view === 'unopened' })
        .order('id')
        .range(from, from + APPLICATIONS_PAGE_SIZE - 1);

      if (view === 'unopened') {
        request = request
          .eq('status', 'new')
          .is('employer_viewed_at', null)
          .lt('created_at', new Date(Date.now() - UNOPENED_AFTER_MS).toISOString());
      } else if (view !== 'all') {
        request = request.eq('status', view);
      }
      if (job) request = request.eq('job_id', job);
      if (candidate) request = request.eq('candidate_id', candidate);
      if (words && UUID.test(words)) {
        request = request.eq('id', words);
      } else if (words) {
        const needle = looseArabicNeedle(words);
        if (needle) request = request.ilike('candidate.full_name', `%${needle}%`);
      }

      const { data, error, count } = await request;
      if (error) throw error;
      const rows = (data ?? []) as unknown as ApplicationListRow[];
      return { rows, total: count ?? rows.length };
    },
    getNextPageParam: (last, pages) =>
      pages.length * APPLICATIONS_PAGE_SIZE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every application across the pages loaded so far, each once. */
export function flattenApplications(pages: ApplicationsPage[] | undefined): ApplicationListRow[] {
  const seen = new Set<string>();
  const rows: ApplicationListRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

export type ApplicationEvent = {
  id: number;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  created_at: string;
  actor: { full_name: string; role: UserRole } | null;
};

/** One application as the website's page reads it: the facts, the parties, every move, and how many notes the employer kept. */
export type ApplicationFile = {
  id: string;
  status: ApplicationStatus;
  /** The candidate's cover note. */
  note: string | null;
  /** The employer's reason for the current status; the candidate sees it. */
  decision_note: string | null;
  experience_band: ExperienceBand | null;
  created_at: string;
  employer_viewed_at: string | null;
  job: {
    id: string;
    title_ar: string;
    title_en: string | null;
    status: JobStatus;
    expires_at: string | null;
    company: { id: string; name_ar: string; name_en: string | null } | null;
  } | null;
  candidate: { id: string; full_name: string; approval_status: ApprovalStatus } | null;
  history: ApplicationEvent[];
  /** The employer's private notes: how many, never what they say. */
  employer_notes: number;
};

export function useApplicationFile(id: string | undefined) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'application', id],
    enabled: open && Boolean(id),
    queryFn: async (): Promise<ApplicationFile | null> => {
      const application = id as string;
      const read = await supabase
        .from('applications')
        .select(
          'id, status, note, decision_note, experience_band, created_at, employer_viewed_at, job:jobs (id, title_ar, title_en, status, expires_at, company:companies (id, name_ar, name_en)), candidate:profiles (id, full_name, approval_status)',
        )
        .eq('id', application)
        .maybeSingle();
      if (read.error) throw read.error;
      if (!read.data) return null;
      const row = read.data as unknown as Omit<ApplicationFile, 'history' | 'employer_notes'>;

      const [events, employerNotes] = await Promise.all([
        supabase
          .from('application_events')
          .select('id, from_status, to_status, created_at, actor:profiles (full_name, role)')
          .eq('application_id', application)
          .order('created_at'),
        supabase.from('application_notes').select('id', { count: 'exact', head: true }).eq('application_id', application),
      ]);
      if (events.error) throw events.error;
      if (employerNotes.error) throw employerNotes.error;

      return {
        ...row,
        history: (events.data ?? []) as unknown as ApplicationEvent[],
        employer_notes: employerNotes.count ?? 0,
      };
    },
  });
}
