import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { listingNotes, noteFor } from '@/lib/listing-notes';
import { looseArabicNeedle } from '@/lib/search/needle';
import type {
  ApplicationStatus,
  CompanySignals,
  JobRow,
  JobStatus,
  ReportReason,
  ReportStatus,
  SafetyFlag,
  VerificationStatus,
} from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * The listings — the website's /admin/jobs and /admin/jobs/<id>, read the
 * same way: every view the website has, with the exact query each one runs,
 * searched and paged as the website pages them; and one listing with
 * everything its review page shows. Every read is an admin's alone
 * (queries.ts says why) and waits for the console's door.
 */

/**
 * The lifecycle, as views, in the website's order. `live`, `expiring` and
 * `quiet` are read off the date rather than the label — the nightly
 * relabelling is housekeeping, not what makes a listing live — and `expired`
 * catches both a relabelled row and an `active` one whose window has passed.
 */
export type ListingsView =
  | 'pending'
  | 'flagged'
  | 'live'
  | 'expiring'
  | 'quiet'
  | 'reported'
  | 'expired'
  | 'closed'
  | 'rejected'
  | 'draft'
  | 'all';

export const LISTINGS_VIEWS: readonly ListingsView[] = [
  'pending',
  'flagged',
  'live',
  'expiring',
  'quiet',
  'reported',
  'expired',
  'closed',
  'rejected',
  'draft',
  'all',
];

export const LISTINGS_PAGE_SIZE = 25;

/** A UUID: a search for one is a search by id; anything else in a company filter is no filter. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id no row has: what the flagged view asks for when nothing is flagged, so it matches nothing rather than everything. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** The most ids admin_job_signals takes in one call (migration 327). */
const SIGNALS_BATCH = 100;

export type ListingRow = {
  id: string;
  title_ar: string;
  title_en: string | null;
  status: JobStatus;
  is_featured: boolean;
  expires_at: string | null;
  published_at: string | null;
  created_at: string;
  company: { id: string; name_ar: string; name_en: string | null; verification_status: VerificationStatus; suspended_at: string | null };
  applications?: { count: number }[] | { id: string }[];
  open_reports?: { id: string }[];
  /** What its own words flag (the pending and flagged views only; empty elsewhere). */
  flags: SafetyFlag[];
};

export type ListingsPage = { rows: ListingRow[]; total: number };

export type ListingsFilter = { view: ListingsView; query: string; companyId: string | null };

/** How many applied: the quiet view asked for the rows to be absent, so its answer is none by construction. */
export function applicantsOf(row: ListingRow, view: ListingsView): number {
  if (view === 'quiet') return 0;
  const first = row.applications?.[0];
  return first && 'count' in first ? first.count : 0;
}

/**
 * One page of one view, as the website's page reads it — the same select,
 * the same filters and the same order, twenty-five at a time. The flagged
 * view is the waiting queue narrowed to what the database's patterns flag,
 * which only it can compute (the patterns never leave it).
 */
async function readListings(filter: ListingsFilter, page: number): Promise<ListingsPage> {
  const { view, companyId } = filter;
  const q = filter.query.trim().slice(0, 120);
  const from = (page - 1) * LISTINGS_PAGE_SIZE;
  const to = from + LISTINGS_PAGE_SIZE - 1;
  const now = new Date().toISOString();
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

  const embeds = [
    'company:companies!inner (id, name_ar, name_en, verification_status, suspended_at)',
    // The quiet view is an anti-join on applications, so it selects the rows
    // it is asking to be absent; every other view counts them.
    view === 'quiet' ? 'applications (id)' : 'applications (count)',
    view === 'reported' ? 'open_reports:reports!inner (id)' : null,
  ].filter(Boolean);

  let flaggedIds: string[] = [];
  if (view === 'flagged') {
    const flagged = await supabase.rpc('admin_flagged_pending_jobs', { p_limit: 500 });
    if (flagged.error) throw flagged.error;
    flaggedIds = flagged.data ?? [];
  }

  let query = supabase
    .from('jobs')
    .select(`id, title_ar, title_en, status, is_featured, expires_at, published_at, created_at, ${embeds.join(', ')}`, {
      count: 'exact',
    });

  switch (view) {
    case 'pending':
      query = query.eq('status', 'pending_review').order('created_at', { ascending: true });
      break;
    case 'flagged':
      query = query
        .eq('status', 'pending_review')
        .in('id', flaggedIds.length ? flaggedIds : [NO_ID])
        .order('created_at', { ascending: true });
      break;
    case 'live':
      query = query.eq('status', 'active').gt('expires_at', now).order('published_at', { ascending: false });
      break;
    case 'expiring':
      query = query.eq('status', 'active').gt('expires_at', now).lte('expires_at', week).order('expires_at');
      break;
    case 'quiet':
      query = query
        .eq('status', 'active')
        .gt('expires_at', now)
        .lt('published_at', threeDaysAgo)
        .is('applications', null)
        .order('published_at');
      break;
    case 'reported':
      query = query.in('open_reports.status', ['open', 'investigating']).order('created_at', { ascending: false });
      break;
    case 'expired':
      query = query
        .or(`status.eq.expired,and(status.eq.active,expires_at.lte.${now})`)
        .order('expires_at', { ascending: false });
      break;
    case 'all':
      query = query.order('created_at', { ascending: false });
      break;
    default:
      query = query.eq('status', view).order('created_at', { ascending: false });
  }
  query = query.order('id').range(from, to);

  if (companyId && UUID.test(companyId)) query = query.eq('company_id', companyId);
  if (q && UUID.test(q)) {
    query = query.eq('id', q);
  } else if (q) {
    const needle = looseArabicNeedle(q);
    if (needle) query = query.or(`title_ar.ilike.*${needle}*,title_en.ilike.*${needle}*,slug.ilike.*${needle}*`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Omit<ListingRow, 'flags'>[];

  // What each waiting listing says that a moderator should look at twice —
  // never more ids in one call than the function takes.
  const flags = new Map<string, SafetyFlag[]>();
  if ((view === 'pending' || view === 'flagged') && rows.length) {
    for (let at = 0; at < rows.length; at += SIGNALS_BATCH) {
      const signals = await supabase.rpc('admin_job_signals', { p_jobs: rows.slice(at, at + SIGNALS_BATCH).map((row) => row.id) });
      if (signals.error) throw signals.error;
      for (const row of signals.data ?? []) flags.set(row.job_id, row.flags);
    }
  }

  return { rows: rows.map((row) => ({ ...row, flags: flags.get(row.id) ?? [] })), total: count ?? rows.length };
}

/** The listings of one view, matching a search and a company if given, twenty-five at a time. */
export function useListings(filter: ListingsFilter) {
  const open = useOpen();
  const needle = filter.query.trim();
  const companyId = filter.companyId && UUID.test(filter.companyId) ? filter.companyId : null;
  return useInfiniteQuery({
    queryKey: ['admin', 'listings', filter.view, needle, companyId],
    enabled: open,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => readListings({ view: filter.view, query: needle, companyId }, pageParam),
    getNextPageParam: (last, pages) =>
      pages.length * LISTINGS_PAGE_SIZE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every listing across the pages loaded so far, each once. */
export function flattenListings(pages: ListingsPage[] | undefined): ListingRow[] {
  const seen = new Set<string>();
  const rows: ListingRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** The stages, in the order the product counts them. */
export const APPLICATION_STAGES: readonly ApplicationStatus[] = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

export type ListingReport = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: { id: string; full_name: string } | null;
};

/** One listing as the moderator decides on it: every text a reader is shown, its flags, its company's signals and its reports. */
export type ListingFile = JobRow & {
  company: {
    id: string;
    name_ar: string;
    name_en: string | null;
    slug: string;
    verification_status: VerificationStatus;
    suspended_at: string | null;
  };
  district: { name_ar: string; name_en: string } | null;
  rejection_note: string | null;
  flags: SafetyFlag[];
  companySignals: CompanySignals | null;
  reports: ListingReport[];
  /** How many applications at each stage: investigating a listing does not need the applicants' names. */
  stages: Record<ApplicationStatus, number>;
};

export function useListingFile(id: string | undefined) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'listing', id],
    enabled: open && Boolean(id),
    queryFn: async (): Promise<ListingFile | null> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, company:companies (id, name_ar, name_en, slug, verification_status, suspended_at), district:districts (name_ar, name_en)',
        )
        .eq('id', id as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const job = data as unknown as Omit<ListingFile, 'rejection_note' | 'flags' | 'companySignals' | 'reports' | 'stages'>;

      const [moderation, signals, reports, ...counts] = await Promise.all([
        // Why it was refused: beside it in job_moderation since migration 347, in its own column before.
        listingNotes(
          (ids) => supabase.from('job_moderation').select('job_id, rejection_note').in('job_id', ids),
          [job.id],
        ),
        supabase.rpc('admin_job_signals', { p_jobs: [job.id] }),
        supabase
          .from('reports')
          .select('id, reason, detail, status, created_at, reporter:profiles!reports_reporter_id_fkey (id, full_name)')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false })
          .limit(50),
        ...APPLICATION_STAGES.map((stage) =>
          supabase.from('applications').select('id', { count: 'exact', head: true }).eq('job_id', job.id).eq('status', stage),
        ),
      ]);
      if (moderation.error) throw moderation.error;
      if (signals.error) throw signals.error;
      if (reports.error) throw reports.error;
      const stages = {} as Record<ApplicationStatus, number>;
      APPLICATION_STAGES.forEach((stage, index) => {
        const counted = counts[index];
        if (counted.error) throw counted.error;
        stages[stage] = counted.count ?? 0;
      });

      const review = signals.data?.[0];
      return {
        ...job,
        rejection_note: noteFor(moderation.notes, job),
        flags: review?.flags ?? [],
        companySignals: review?.company_signals ?? null,
        reports: (reports.data ?? []) as unknown as ListingReport[],
        stages,
      };
    },
  });
}
