import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Archive, Check, ChevronDown, ChevronUp, Clock, ExternalLink, Flag, Star, X } from 'lucide-react';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { EntityLink } from '@/components/admin/entity-link';
import { RowActions, type RowAction } from '@/components/admin/row-actions';
import { FilterBar } from '@/components/admin/filter-bar';
import { AdminTable, FilterTabs, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { JobStatusBadge } from '@/components/admin/badges';
import { FlagCount } from '@/components/admin/safety';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must, mustPage } from '@/lib/admin/read';
import { PAGE_SIZE, UUID_RE, cairoDayStart, dayOf, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { defaultSort, jobListContext, jobReviewHref } from '@/lib/admin/job-neighbours';
import { looseArabicNeedle } from '@/lib/search/needle';
import { formatDayMonth } from '@/lib/format';
import { formatDate, formatNumber } from '@/lib/utils';
import type { JobStatus, SafetyFlag } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('jobsQueue'), robots: { index: false, follow: false } };
}

/**
 * The lifecycle, as tabs. `live`, `expiring` and `quiet` are read off the date
 * rather than the label — the nightly relabelling is housekeeping, not what
 * makes a listing live — and `expired` catches both a relabelled row and an
 * `active` one whose window has passed.
 */
const VIEWS = [
  'all',
  'pending',
  // Waiting for review, and the listing's own text carries a high-weight
  // flag (migration 327): money asked of the candidate, ID or bank details,
  // a link that hides where it goes. For a closer look, not a verdict.
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
type View = (typeof VIEWS)[number];

type JobListRow = {
  id: string;
  slug: string;
  version: number;
  title_ar: string;
  title_en: string | null;
  status: JobStatus;
  is_featured: boolean;
  expires_at: string | null;
  published_at: string | null;
  created_at: string;
  company: { id: string; name_ar: string; name_en: string | null; verification_status: string; suspended_at?: string | null };
  applications?: { count: number }[];
  open_reports?: { id: string }[];
};

export default async function AdminJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const sp = await searchParams;
  const q = param(sp, 'q');
  const view: View = oneOf(param(sp, 'status'), VIEWS, 'all');
  const companyId = param(sp, 'company');
  const published = dayOf(param(sp, 'published'));
  const page = pageOf(sp);
  const [from, to] = rangeOf(page);
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

  const supabase = await createClient();

  // The flagged view is the waiting queue narrowed to what the database's
  // patterns flag, which only it can compute (the patterns never leave it).
  const flaggedIds =
    view === 'flagged'
      ? must(await supabase.rpc('admin_flagged_pending_jobs', { p_limit: 500 }), 'loading flagged listings').data ?? []
      : [];

  let query = supabase
    .from('jobs')
    .select(`id, slug, version, title_ar, title_en, status, is_featured, expires_at, published_at, created_at, ${embeds.join(', ')}`, {
      count: 'exact',
    });

  switch (view) {
    case 'pending':
      query = query.eq('status', 'pending_review').order('created_at', { ascending: true });
      break;
    case 'flagged':
      query = query
        .eq('status', 'pending_review')
        // An empty list still has to match nothing rather than everything.
        .in('id', flaggedIds.length ? flaggedIds : ['00000000-0000-0000-0000-000000000000'])
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

  if (companyId && UUID_RE.test(companyId)) query = query.eq('company_id', companyId);
  if (published) {
    query = query.gte('published_at', cairoDayStart(published)).lt('published_at', cairoDayStart(published, 1));
  }
  if (q && UUID_RE.test(q)) {
    query = query.eq('id', q);
  } else if (q) {
    const needle = looseArabicNeedle(q);
    if (needle) query = query.or(`title_ar.ilike.*${needle}*,title_en.ilike.*${needle}*,slug.ilike.*${needle}*`);
  }

  const current = { q, status: view === 'all' ? undefined : view, company: companyId, published };
  const reviewContext = jobListContext({ tab: view, sort: defaultSort(view), q, company: companyId });
  const read = await mustPage(await query, 'loading listings', locale, {
    page,
    href: (n) => hrefWith('/admin/jobs', current, { page: n }),
  });
  const rows = read.data as unknown as JobListRow[];

  // What each waiting listing says that a moderator should look at twice.
  const flags = new Map<string, SafetyFlag[]>();
  if ((view === 'pending' || view === 'flagged') && rows.length) {
    const signals = must(
      await supabase.rpc('admin_job_signals', { p_jobs: rows.map((row) => row.id) }),
      'loading listing flags',
    ).data;
    for (const row of signals ?? []) flags.set(row.job_id, row.flags);
  }

  const t = await getTranslations('admin');
  const waitingDays = (since: string) => Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));

  const publicListing = (status: JobStatus) => status === 'active' || status === 'expired' || status === 'closed';

  const columns: Column<JobListRow>[] = [
    {
      key: 'title',
      header: t('colListing'),
      cell: (row) => (
        <EntityLink href={`/admin/jobs/${row.id}`} className="font-medium">
          {localized(locale, row.title_ar, row.title_en)}
        </EntityLink>
      ),
      mobile: 'title',
    },
    {
      key: 'company',
      header: t('colCompany'),
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <EntityLink href={`/admin/companies/${row.company.id}`}>
            {localized(locale, row.company.name_ar, row.company.name_en)}
          </EntityLink>
          {row.company.suspended_at ? <Badge variant="destructive">{t('suspended')}</Badge> : null}
        </span>
      ),
      mobile: 'meta',
    },
    {
      key: 'when',
      header: view === 'pending' ? t('colWaiting') : view === 'expiring' ? t('colExpires') : t('colDate'),
      cell: (row) =>
        view === 'pending' ? (
          <span className={waitingDays(row.created_at) >= 1 ? 'inline-flex items-center gap-1 text-destructive' : 'inline-flex items-center gap-1'}>
            <Clock className="size-3.5" aria-hidden />
            {t('waiting', { days: waitingDays(row.created_at) })}
          </span>
        ) : view === 'expiring' && row.expires_at ? (
          formatDate(row.expires_at, locale)
        ) : (
          formatDate(row.published_at ?? row.created_at, locale)
        ),
      mobile: 'meta',
    },
    {
      key: 'applicants',
      header: t('colApplicants'),
      cell: (row) => (
        <span className="numeral">{formatNumber(view === 'quiet' ? 0 : (row.applications?.[0]?.count ?? 0), locale)}</span>
      ),
      mobile: 'meta',
    },
    {
      key: 'status',
      header: t('colStatus'),
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-1">
          <JobStatusBadge status={row.status} expiresAt={row.expires_at} />
          {row.is_featured ? <Star className="size-3.5 text-warning" role="img" aria-label={t('featured')} /> : null}
          <FlagCount flags={flags.get(row.id) ?? []} locale={locale} />
          {row.open_reports?.length ? (
            <Badge variant="destructive">
              <Flag aria-hidden />
              <span className="numeral">{row.open_reports.length}</span>
            </Badge>
          ) : null}
        </span>
      ),
      mobile: 'aside',
    },
    {
      key: 'actions',
      header: t('colActions'),
      className: 'w-px',
      cell: (row) => {
        const index = rows.findIndex((item) => item.id === row.id);
        const title = localized(locale, row.title_ar, row.title_en);
        const actions: RowAction[] = [];
        if (row.status === 'pending_review') {
          actions.push({
            id: 'approve',
            kind: 'lever',
            primary: true,
            tone: 'success',
            label: t('approve'),
            title: t('approve'),
            icon: <Check aria-hidden />,
            lever: { do: 'job', jobId: row.id, action: 'approve', version: row.version },
            reason: 'none',
          });
          actions.push({
            id: 'reject',
            kind: 'lever',
            primary: true,
            tone: 'destructive',
            label: t('reject'),
            title: t('reject'),
            body: title,
            icon: <X aria-hidden />,
            lever: { do: 'job', jobId: row.id, action: 'reject', version: row.version },
            reason: 'optional',
            reasonLabel: t('reasonToCompany'),
          });
        }
        if (row.status === 'active' || row.status === 'expired') {
          actions.push({
            id: 'close',
            kind: 'lever',
            primary: true,
            label: t('closeListing'),
            title: t('closeListing'),
            body: title,
            icon: <Archive aria-hidden />,
            lever: { do: 'job', jobId: row.id, action: 'close', version: row.version },
            reason: 'optional',
            reasonLabel: t('reasonToCompany'),
          });
        }
        if (publicListing(row.status)) {
          actions.push({
            id: 'public',
            kind: 'link',
            primary: true,
            label: t('openPublic'),
            icon: <ExternalLink aria-hidden />,
            href: `/jobs/${row.slug}`,
          });
        }
        if (index > 0) {
          actions.push({
            id: 'prev',
            kind: 'link',
            label: t('prevReview'),
            icon: <ChevronUp aria-hidden />,
            href: jobReviewHref(rows[index - 1].id, reviewContext),
          });
        }
        if (index >= 0 && index < rows.length - 1) {
          actions.push({
            id: 'next',
            kind: 'link',
            label: t('nextReview'),
            icon: <ChevronDown aria-hidden />,
            href: jobReviewHref(rows[index + 1].id, reviewContext),
          });
        }
        return <RowActions actions={actions} />;
      },
      mobile: 'meta',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('jobsQueue')} lede={t('jobsQueueLede')} />

      <FilterTabs
        label={t('colStatus')}
        items={VIEWS.map((value) => ({
          key: value,
          label: t(`jobView.${value}`),
          href: hrefWith('/admin/jobs', current, { status: value === 'all' ? undefined : value }),
          active: view === value,
        }))}
      />

      <FilterBar
        filters={[]}
        chips={[
          ...(q
            ? [{
                key: 'q',
                label: t('searchChip', { q }),
                href: hrefWith('/admin/jobs', current, { q: undefined }),
                remove: t('removeFilter', { filter: t('search') }),
              }]
            : []),
          ...(companyId
            ? [{
                key: 'company',
                label: t('colCompany'),
                href: hrefWith('/admin/jobs', current, { company: undefined }),
                remove: t('removeFilter', { filter: t('colCompany') }),
              }]
            : []),
          ...(published
            ? [{
                key: 'published',
                label: formatDayMonth(`${published}T12:00:00Z`, locale),
                href: hrefWith('/admin/jobs', current, { published: undefined }),
                remove: t('removeFilter', { filter: t('filteredToDay') }),
              }]
            : []),
        ]}
        clearHref={hrefWith('/admin/jobs', { status: current.status }, {})}
        clearLabel={t('clearListFilters')}
      >
        <SearchForm
          locale={locale}
          path="/admin/jobs"
          q={q}
          keep={{ status: current.status, company: current.company, published: current.published }}
          placeholder={t('jobsSearchPlaceholder')}
          label={t('search')}
        />
      </FilterBar>

      {view === 'quiet' ? <p className="text-sm text-muted-foreground">{t('quietHint')}</p> : null}

      <AdminTable
        caption={t('jobsQueue')}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={(row) => jobReviewHref(row.id, reviewContext)}
        rowLabel={(row) => localized(locale, row.title_ar, row.title_en)}
        empty={q ? t('searchNothing') : t('emptyQueue')}
      />

      <Pager
        page={page}
        total={read.count}
        size={PAGE_SIZE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/jobs', current, { page: next })}
      />
    </div>
  );
}
