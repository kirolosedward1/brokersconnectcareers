import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Clock, Flag, Star } from 'lucide-react';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { AdminTable, FilterTabs, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { JobStatusBadge } from '@/components/admin/badges';
import { FlagCount } from '@/components/admin/safety';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must, mustPage } from '@/lib/admin/read';
import { PAGE_SIZE, UUID_RE, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { likeNeedle } from '@/lib/search/needle';
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
  'all',
] as const;
type View = (typeof VIEWS)[number];

type JobListRow = {
  id: string;
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
  const view: View = oneOf(param(sp, 'status'), VIEWS, 'pending');
  const companyId = param(sp, 'company');
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
  if (q && UUID_RE.test(q)) {
    query = query.eq('id', q);
  } else if (q) {
    const needle = likeNeedle(q);
    if (needle) query = query.or(`title_ar.ilike.*${needle}*,title_en.ilike.*${needle}*,slug.ilike.*${needle}*`);
  }

  const current = { q, status: view === 'pending' ? undefined : view, company: companyId };
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

  const columns: Column<JobListRow>[] = [
    { key: 'title', header: t('colListing'), cell: (row) => localized(locale, row.title_ar, row.title_en), mobile: 'title' },
    {
      key: 'company',
      header: t('colCompany'),
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {localized(locale, row.company.name_ar, row.company.name_en)}
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
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('jobsQueue')} lede={t('jobsQueueLede')} />

      <SearchForm
        locale={locale}
        path="/admin/jobs"
        q={q}
        keep={{ status: current.status, company: current.company }}
        placeholder={t('jobsSearchPlaceholder')}
        label={t('search')}
      />

      <FilterTabs
        label={t('colStatus')}
        items={VIEWS.map((value) => ({
          key: value,
          label: t(`jobView.${value}`),
          href: hrefWith('/admin/jobs', current, { status: value === 'pending' ? undefined : value }),
          active: view === value,
        }))}
      />

      {view === 'quiet' ? <p className="text-sm text-muted-foreground">{t('quietHint')}</p> : null}

      <AdminTable
        caption={t('jobsQueue')}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={(row) => `/admin/jobs/${row.id}`}
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
