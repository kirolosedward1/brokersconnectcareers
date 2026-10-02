import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { AdminTable, FilterTabs, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mustPage } from '@/lib/admin/read';
import { PAGE_SIZE, UUID_RE, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { likeNeedle } from '@/lib/search/needle';
import { formatDate } from '@/lib/utils';
import type { ApplicationStatus } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('applications'), robots: { index: false, follow: false } };
}

const VIEWS = ['all', 'unopened', 'new', 'shortlisted', 'interview', 'hired', 'rejected'] as const;

type ApplicationListRow = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  employer_viewed_at: string | null;
  job: { id: string; title_ar: string; title_en: string | null; company: { name_ar: string; name_en: string | null } | null };
  candidate: { id: string; full_name: string } | null;
};

/**
 * Applications, for investigating — not for handling.
 *
 * There is no lever on this page or behind it. Moving an application is the
 * employer's decision and withdrawing it is the candidate's; an admin who
 * changed either would be putting words in somebody's mouth. What an admin
 * needs is to see what happened — when it was sent, whether it was opened,
 * who moved it and when — which is what the detail page shows.
 *
 * `unopened` is the complaint support actually receives: "I applied a week ago
 * and nobody looked". It is new, never opened, and more than seven days old.
 */
export default async function AdminApplicationsPage({
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
  const view = oneOf(param(sp, 'status'), VIEWS, 'all');
  const jobId = param(sp, 'job');
  const candidateId = param(sp, 'candidate');
  const page = pageOf(sp);
  const [from, to] = rangeOf(page);

  const supabase = await createClient();
  let query = supabase
    .from('applications')
    .select(
      `id, status, created_at, employer_viewed_at,
       job:jobs!inner (id, title_ar, title_en, company:companies (name_ar, name_en)),
       candidate:profiles!inner (id, full_name)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: view === 'unopened' })
    .order('id')
    .range(from, to);

  if (view === 'unopened') {
    query = query
      .eq('status', 'new')
      .is('employer_viewed_at', null)
      .lt('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString());
  } else if (view !== 'all') {
    query = query.eq('status', view);
  }
  if (jobId && UUID_RE.test(jobId)) query = query.eq('job_id', jobId);
  if (candidateId && UUID_RE.test(candidateId)) query = query.eq('candidate_id', candidateId);
  if (q && UUID_RE.test(q)) {
    query = query.eq('id', q);
  } else if (q) {
    const needle = likeNeedle(q);
    if (needle) query = query.ilike('candidate.full_name', `%${needle}%`);
  }

  const current = {
    q,
    status: view === 'all' ? undefined : view,
    job: jobId,
    candidate: candidateId,
  };
  const read = await mustPage(await query, 'loading applications', locale, {
    page,
    href: (n) => hrefWith('/admin/applications', current, { page: n }),
  });
  const rows = read.data as unknown as ApplicationListRow[];

  const t = await getTranslations('admin');
  const tApplication = await getTranslations('applicationStatus');

  const columns: Column<ApplicationListRow>[] = [
    { key: 'candidate', header: t('colCandidate'), cell: (row) => row.candidate?.full_name ?? '—', mobile: 'title' },
    { key: 'job', header: t('colListing'), cell: (row) => localized(locale, row.job.title_ar, row.job.title_en), mobile: 'meta' },
    {
      key: 'company',
      header: t('colCompany'),
      cell: (row) => (row.job.company ? localized(locale, row.job.company.name_ar, row.job.company.name_en) : '—'),
      mobile: 'hidden',
    },
    { key: 'sent', header: t('colSent'), cell: (row) => formatDate(row.created_at, locale), mobile: 'meta' },
    {
      key: 'opened',
      header: t('colOpened'),
      cell: (row) => (row.employer_viewed_at ? formatDate(row.employer_viewed_at, locale) : t('notOpened')),
      mobile: 'meta',
    },
    { key: 'status', header: t('colStatus'), cell: (row) => <Badge variant="outline">{tApplication(row.status)}</Badge>, mobile: 'aside' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('applications')} lede={t('applicationsLede')} />

      <SearchForm
        locale={locale}
        path="/admin/applications"
        q={q}
        keep={{ status: current.status, job: jobId, candidate: candidateId }}
        placeholder={t('applicationsSearchPlaceholder')}
        label={t('search')}
      />

      {jobId || candidateId ? (
        <p className="text-sm text-muted-foreground">
          {t('filteredToOne')}{' '}
          <Link href={hrefWith('/admin/applications', { status: current.status }, {})} className="text-primary hover:underline">
            {t('clearFilter')}
          </Link>
        </p>
      ) : null}

      <FilterTabs
        label={t('colStatus')}
        items={VIEWS.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAll') : value === 'unopened' ? t('unopenedTab') : tApplication(value),
          href: hrefWith('/admin/applications', current, { status: value === 'all' ? undefined : value }),
          active: view === value,
        }))}
      />

      <AdminTable
        caption={t('applications')}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={(row) => `/admin/applications/${row.id}`}
        empty={q ? t('searchNothing') : t('emptyQueue')}
      />

      <Pager
        page={page}
        total={read.count}
        size={PAGE_SIZE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/applications', current, { page: next })}
      />
    </div>
  );
}
