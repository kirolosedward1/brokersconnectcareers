import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { looseArabicNeedle } from '@/lib/search/needle';
import type {
  ApprovalStatus,
  CompanyDocumentRow,
  CompanyMemberRole,
  CompanyRow,
  CompanySignals,
  JobStatus,
  ReportReason,
  ReportStatus,
  SafetyFlag,
} from '@/lib/supabase/database.types';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * The companies — the website's /admin/companies and /admin/companies/<id>,
 * read the same way: every view the website has (the verification queue
 * first, oldest first; every other view newest first), searched over both
 * names and the slug, twenty-five at a time; and one company's page with
 * everything the website's shows. Every read is an admin's alone (queries.ts
 * says why) and waits for the console's door.
 */

export type CompaniesView = 'pending' | 'verified' | 'unverified' | 'rejected' | 'suspended' | 'all';

export const COMPANIES_VIEWS: readonly CompaniesView[] = ['pending', 'verified', 'unverified', 'rejected', 'suspended', 'all'];

export const COMPANIES_PAGE_SIZE = 25;

export type CompanyListRow = Pick<
  CompanyRow,
  'id' | 'name_ar' | 'name_en' | 'slug' | 'logo_url' | 'verification_status' | 'suspended_at' | 'created_at'
> & { jobs: { count: number }[]; company_members: { count: number }[] };

export type CompaniesPage = { rows: CompanyListRow[]; total: number };

/** How many of something, as PostgREST counts an embedded table. */
export function countOf(cells: { count: number }[] | undefined): number {
  return cells?.[0]?.count ?? 0;
}

/** One page of one view, as the website's page reads it. */
async function readCompanies(view: CompaniesView, needle: string, page: number): Promise<CompaniesPage> {
  const from = (page - 1) * COMPANIES_PAGE_SIZE;
  const to = from + COMPANIES_PAGE_SIZE - 1;
  let query = supabase
    .from('companies')
    .select(
      `id, name_ar, name_en, slug, logo_url, verification_status, suspended_at, created_at, jobs (count), company_members (count)${
        view === 'pending' ? ', company_documents!inner (id)' : ''
      }`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: view === 'pending' })
    .order('id')
    .range(from, to);

  if (view === 'suspended') query = query.not('suspended_at', 'is', null);
  else if (view !== 'all') {
    query = query.eq('verification_status', view);
    if (view === 'pending') query = query.eq('company_documents.status', 'pending');
  }

  if (needle) query = query.or(`name_ar.ilike.*${needle}*,name_en.ilike.*${needle}*,slug.ilike.*${needle}*`);

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as CompanyListRow[];
  return { rows, total: count ?? rows.length };
}

/** The companies of one view, matching a search if there is one, twenty-five at a time. */
export function useCompanyList(view: CompaniesView, query: string) {
  const open = useOpen();
  const words = query.trim().slice(0, 120);
  const needle = words ? looseArabicNeedle(words) : '';
  return useInfiniteQuery({
    queryKey: ['admin', 'companies', view, needle],
    enabled: open,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => readCompanies(view, needle, pageParam),
    getNextPageParam: (last, pages) =>
      pages.length * COMPANIES_PAGE_SIZE < last.total && last.rows.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every company across the pages loaded so far, each once. */
export function flattenCompanies(pages: CompaniesPage[] | undefined): CompanyListRow[] {
  const seen = new Set<string>();
  const rows: CompanyListRow[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

/** A paper as the page lists it: never its storage path, which is opened only through a link made per tap. */
export type CompanyPaper = Pick<CompanyDocumentRow, 'id' | 'doc_type' | 'status' | 'review_note' | 'created_at'>;

export type CompanyMember = {
  role: CompanyMemberRole;
  created_at: string;
  profile: { id: string; full_name: string; approval_status: ApprovalStatus } | null;
};

export type CompanyListing = {
  id: string;
  title_ar: string;
  title_en: string | null;
  status: JobStatus;
  expires_at: string | null;
  created_at: string;
  applications: { count: number }[];
};

export type CompanyReport = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: { id: string; full_name: string } | null;
};

/** One company's page: everything the website's shows (the record reads itself, components/admin/record.tsx). */
export type CompanyFile = {
  company: CompanyRow & { district: { name_ar: string; name_en: string } | null };
  papers: CompanyPaper[];
  members: CompanyMember[];
  listings: CompanyListing[];
  /** Every listing the company has, not only the twenty newest drawn. */
  listingsTotal: number;
  /** Open reports on its listings, counted. */
  openListingReports: number;
  reports: CompanyReport[];
  /** The suspension reason lives in company_moderation (migration 327); the companies row is readable by anybody. */
  suspensionReason: string | null;
  flags: SafetyFlag[];
  signals: CompanySignals | null;
};

export function useCompanyFile(id: string | undefined) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'company', id],
    enabled: open && Boolean(id),
    queryFn: async (): Promise<CompanyFile | null> => {
      const companyId = id as string;
      // admin_company(): the whole row, owner and credits included, which the
      // table no longer gives a session (migration 369).
      const read = await supabase
        .rpc('admin_company', { p_company: companyId })
        .select('*, district:districts (name_ar, name_en)')
        .maybeSingle();
      if (read.error) throw read.error;
      if (!read.data) return null;
      const company = read.data as unknown as CompanyFile['company'];

      const [documents, members, jobs, reports, jobReports, moderation, signals] = await Promise.all([
        supabase
          .from('company_documents')
          .select('id, doc_type, status, review_note, created_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false }),
        supabase
          .from('company_members')
          .select('role, created_at, profile:profiles (id, full_name, approval_status)')
          .eq('company_id', companyId)
          .order('created_at'),
        supabase
          .from('jobs')
          .select('id, title_ar, title_en, status, expires_at, created_at, applications (count)', { count: 'exact' })
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('reports')
          .select('id, reason, detail, status, created_at, reporter:profiles!reports_reporter_id_fkey (id, full_name)')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('reports')
          .select('id, job:jobs!inner (company_id)', { count: 'exact', head: true })
          .eq('job.company_id', companyId)
          .in('status', ['open', 'investigating']),
        supabase.from('company_moderation').select('suspension_reason').eq('company_id', companyId).maybeSingle(),
        supabase.rpc('admin_company_signals', { p_companies: [companyId] }),
      ]);
      if (documents.error) throw documents.error;
      if (members.error) throw members.error;
      if (jobs.error) throw jobs.error;
      if (reports.error) throw reports.error;
      if (jobReports.error) throw jobReports.error;
      if (moderation.error) throw moderation.error;
      if (signals.error) throw signals.error;

      const review = signals.data?.[0];
      const listings = (jobs.data ?? []) as unknown as CompanyListing[];
      return {
        company,
        papers: (documents.data ?? []) as CompanyPaper[],
        members: (members.data ?? []) as unknown as CompanyMember[],
        listings,
        listingsTotal: jobs.count ?? listings.length,
        openListingReports: jobReports.count ?? 0,
        reports: (reports.data ?? []) as unknown as CompanyReport[],
        suspensionReason: moderation.data?.suspension_reason ?? null,
        flags: review?.flags ?? [],
        signals: review?.signals ?? null,
      };
    },
  });
}
