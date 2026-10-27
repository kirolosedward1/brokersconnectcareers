/**
 * The listing before this one, and the one after, in the list the admin came from.
 *
 * The list's address is the context: `tab` is the same view the queue uses,
 * `sort` is oldest or newest. A job opened from the pending-review queue is
 * oldest first. The ids are computed here, on the server, for an admin — the
 * page only receives the two neighbours and where this listing sits.
 */

import { UUID_RE } from '@/lib/admin/params';
import { looseArabicNeedle } from '@/lib/search/needle';

export const JOB_TABS = [
  'all',
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
] as const;

export type JobTab = (typeof JOB_TABS)[number];
export type JobSort = 'oldest' | 'newest';

export type JobListContext = {
  tab: JobTab;
  sort: JobSort;
  q?: string;
  company?: string;
};

const SORT_COLUMN: Record<JobTab, 'created_at' | 'published_at' | 'expires_at'> = {
  all: 'created_at',
  pending: 'created_at',
  flagged: 'created_at',
  live: 'published_at',
  expiring: 'expires_at',
  quiet: 'published_at',
  reported: 'created_at',
  expired: 'expires_at',
  closed: 'created_at',
  rejected: 'created_at',
  draft: 'created_at',
};

/** The order that tab uses when nobody has asked for another. Pending is oldest. */
export function defaultSort(tab: JobTab): JobSort {
  return tab === 'pending' || tab === 'flagged' || tab === 'expiring' || tab === 'quiet' ? 'oldest' : 'newest';
}

export function jobListContext(input: {
  tab?: string | null;
  status?: string | null;
  sort?: string | null;
  q?: string | null;
  company?: string | null;
}): JobListContext {
  const named = input.tab || input.status || '';
  const tab: JobTab = (JOB_TABS as readonly string[]).includes(named) ? (named as JobTab) : 'pending';
  const sort: JobSort = input.sort === 'oldest' || input.sort === 'newest' ? input.sort : defaultSort(tab);
  const q = input.q?.trim().slice(0, 120) || undefined;
  const company = input.company && UUID_RE.test(input.company) ? input.company : undefined;
  return { tab, sort, q, company };
}

export function jobContextQuery(context: JobListContext): string {
  const params = new URLSearchParams();
  params.set('tab', context.tab);
  params.set('sort', context.sort);
  if (context.q) params.set('q', context.q);
  if (context.company) params.set('company', context.company);
  return params.toString();
}

export function jobReviewHref(id: string, context: JobListContext): string {
  return `/admin/jobs/${id}?${jobContextQuery(context)}`;
}

/** The list this review was opened from, in the list page's own query (`status`, not `tab`). */
export function jobListHref(context: JobListContext): string {
  const params = new URLSearchParams();
  if (context.tab !== 'all') params.set('status', context.tab);
  if (context.q) params.set('q', context.q);
  if (context.company) params.set('company', context.company);
  const query = params.toString();
  return query ? `/admin/jobs?${query}` : '/admin/jobs';
}

/** Which column this list is ordered by, and whether the first row is the oldest. */
export function orderOf(context: JobListContext): { column: 'created_at' | 'published_at' | 'expires_at'; ascending: boolean } {
  return { column: SORT_COLUMN[context.tab], ascending: context.sort === 'oldest' };
}

/**
 * The PostgREST `or` filter for the rows on one side of a listing.
 *
 * `before` is what the reader has already passed. Oldest-first, that is an
 * earlier timestamp; newest-first, a later one. The id breaks a tie the same
 * way the list does: ascending, so a smaller id comes first.
 */
export function sideFilter(
  column: string,
  value: string,
  id: string,
  side: 'before' | 'after',
  ascending: boolean,
): string {
  const earlier = side === 'before' ? ascending : !ascending;
  const op = earlier ? 'lt' : 'gt';
  const idOp = side === 'before' ? 'lt' : 'gt';
  return `${column}.${op}.${value},and(${column}.eq.${value},id.${idOp}.${id})`;
}

type QueryError = { message?: string; code?: string | null } | null;
type Rows = { data: { id: string }[] | null; error: QueryError; count?: number | null };

/** The real query builder. Loose on purpose: PostgREST's chain is the type. */
type NeighbourQuery = PromiseLike<Rows> & {
  eq: (column: string, value: string) => NeighbourQuery;
  neq: (column: string, value: string) => NeighbourQuery;
  gt: (column: string, value: string) => NeighbourQuery;
  lt: (column: string, value: string) => NeighbourQuery;
  lte: (column: string, value: string) => NeighbourQuery;
  is: (column: string, value: null) => NeighbourQuery;
  in: (column: string, values: string[]) => NeighbourQuery;
  or: (filters: string) => NeighbourQuery;
  order: (column: string, options?: { ascending?: boolean }) => NeighbourQuery;
  limit: (n: number) => NeighbourQuery;
};

export type JobAnchor = {
  id: string;
  status: string;
  created_at: string;
  published_at: string | null;
  expires_at: string | null;
  title_ar?: string;
  title_en?: string | null;
  slug?: string;
};

export type JobNeighbours = {
  previousId: string | null;
  nextId: string | null;
  /** 1-based, when this listing is in the list. Null when the filter excludes it. */
  position: number | null;
  total: number;
  /** The next listing still waiting for review, oldest first, after this one. */
  nextPendingId: string | null;
};

type Builder = {
  from: (table: 'jobs') => {
    select: (columns: string, options?: { count?: 'exact'; head?: boolean }) => NeighbourQuery;
  };
  rpc: (
    fn: 'admin_flagged_pending_jobs',
    args: { p_limit: number },
  ) => PromiseLike<{ data: string[] | null; error: QueryError }>;
};

function anchorValue(job: JobAnchor, column: 'created_at' | 'published_at' | 'expires_at'): string | null {
  return job[column];
}

/**
 * Apply one queue's filter. Mirrors the listings page, including the views
 * that are a date rather than a status word.
 */
export function applyJobFilter(query: NeighbourQuery, context: JobListContext, now: Date, flaggedIds: string[]): NeighbourQuery {
  const iso = now.toISOString();
  const week = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  let next = query;
  if (context.company) next = next.eq('company_id', context.company);
  if (context.q && UUID_RE.test(context.q)) next = next.eq('id', context.q);
  else if (context.q) {
    const needle = looseArabicNeedle(context.q);
    if (needle) next = next.or(`title_ar.ilike.*${needle}*,title_en.ilike.*${needle}*,slug.ilike.*${needle}*`);
  }

  switch (context.tab) {
    case 'pending':
      return next.eq('status', 'pending_review');
    case 'flagged':
      return next.eq('status', 'pending_review').in('id', flaggedIds.length ? flaggedIds : ['00000000-0000-0000-0000-000000000000']);
    case 'live':
      return next.eq('status', 'active').gt('expires_at', iso);
    case 'expiring':
      return next.eq('status', 'active').gt('expires_at', iso).lte('expires_at', week);
    case 'quiet':
      return next.eq('status', 'active').gt('expires_at', iso).lt('published_at', threeDaysAgo).is('applications', null);
    case 'reported':
      return next.in('open_reports.status', ['open', 'investigating']);
    case 'expired':
      return next.or(`status.eq.expired,and(status.eq.active,expires_at.lte.${iso})`);
    case 'all':
      return next;
    default:
      return next.eq('status', context.tab);
  }
}

async function one(query: PromiseLike<Rows>): Promise<{ id: string }[]> {
  const result = await query;
  if (result.error) throw new Error(result.error.message ?? 'neighbour query failed');
  return result.data ?? [];
}

async function countOf(query: PromiseLike<Rows>): Promise<number> {
  const result = await query;
  if (result.error) throw new Error(result.error.message ?? 'neighbour count failed');
  return result.count ?? 0;
}

function selectFor(context: JobListContext): string {
  // The same embeds the list uses, so a filter on them is a filter on a
  // column the query actually selected.
  if (context.tab === 'quiet') return 'id, applications (id)';
  if (context.tab === 'reported') return 'id, open_reports:reports!inner (id)';
  return 'id';
}

/**
 * Previous, next, and where this listing sits.
 *
 * Five small reads, not the whole queue: how many match, how many are before
 * this one, the row on each side, and the next listing still waiting.
 */
export async function jobNeighbours(db: Builder, job: JobAnchor, context: JobListContext, now = new Date()): Promise<JobNeighbours> {
  const flagged =
    context.tab === 'flagged'
      ? (await db.rpc('admin_flagged_pending_jobs', { p_limit: 500 })).data ?? []
      : [];

  const { column, ascending } = orderOf(context);
  const value = anchorValue(job, column);
  const base = () => applyJobFilter(db.from('jobs').select(selectFor(context), { count: 'exact', head: true }), context, now, flagged);

  const total = await countOf(base());
  const inList = value
    ? (await countOf(applyJobFilter(db.from('jobs').select(selectFor(context), { count: 'exact', head: true }).eq('id', job.id), context, now, flagged))) > 0
    : false;

  let before = 0;
  let previousId: string | null = null;
  let nextId: string | null = null;

  if (value) {
    const beforeQuery = applyJobFilter(db.from('jobs').select(selectFor(context), { count: 'exact', head: true }), context, now, flagged).or(
      sideFilter(column, value, job.id, 'before', ascending),
    );
    before = await countOf(beforeQuery);

    const previousRows = await one(
      applyJobFilter(db.from('jobs').select(selectFor(context)), context, now, flagged)
        .or(sideFilter(column, value, job.id, 'before', ascending))
        .order(column, { ascending: !ascending })
        .order('id', { ascending: false })
        .limit(1),
    );
    previousId = previousRows[0]?.id ?? null;

    const nextRows = await one(
      applyJobFilter(db.from('jobs').select(selectFor(context)), context, now, flagged)
        .or(sideFilter(column, value, job.id, 'after', ascending))
        .order(column, { ascending })
        .order('id', { ascending: true })
        .limit(1),
    );
    nextId = nextRows[0]?.id ?? null;
  }

  const pendingAfter = await one(
    db
      .from('jobs')
      .select('id')
      .eq('status', 'pending_review')
      .neq('id', job.id)
      .or(sideFilter('created_at', job.created_at, job.id, 'after', true))
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1),
  );
  const pendingAny = pendingAfter[0]?.id
    ? pendingAfter
    : await one(
        db
          .from('jobs')
          .select('id')
          .eq('status', 'pending_review')
          .neq('id', job.id)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(1),
      );

  return {
    previousId,
    nextId,
    position: inList ? before + 1 : null,
    total,
    nextPendingId: pendingAny[0]?.id ?? null,
  };
}
