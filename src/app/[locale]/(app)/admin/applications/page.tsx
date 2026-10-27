import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, Star, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { EntityLink } from '@/components/admin/entity-link';
import { RowActions, type RowAction } from '@/components/admin/row-actions';
import { AdminTable, FilterTabs, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mustPage } from '@/lib/admin/read';
import { PAGE_SIZE, UUID_RE, cairoDayStart, dayOf, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { PIPELINE_STAGES } from '@/lib/application-stages';
import { looseArabicNeedle } from '@/lib/search/needle';
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
  job: { id: string; title_ar: string; title_en: string | null; company: { id: string; name_ar: string; name_en: string | null } | null };
  candidate: { id: string; full_name: string } | null;
};

/**
 * Applications, for investigating, with a stage move when support has to.
 *
 * Withdrawing stays the candidate's. A stage change uses the same pipeline
 * move an employer uses, so the candidate is emailed. The detail page is
 * where the history of who moved it lives.
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
  const day = dayOf(param(sp, 'day'));
  const page = pageOf(sp);
  const [from, to] = rangeOf(page);

  const supabase = await createClient();
  let query = supabase
    .from('applications')
    .select(
      `id, status, created_at, employer_viewed_at,
       job:jobs!inner (id, title_ar, title_en, company:companies (id, name_ar, name_en)),
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
  if (day) query = query.gte('created_at', cairoDayStart(day)).lt('created_at', cairoDayStart(day, 1));
  if (q && UUID_RE.test(q)) {
    query = query.eq('id', q);
  } else if (q) {
    const needle = looseArabicNeedle(q);
    if (needle) query = query.ilike('candidate.full_name', `%${needle}%`);
  }

  const current = {
    q,
    status: view === 'all' ? undefined : view,
    job: jobId,
    candidate: candidateId,
    day,
  };
  const read = await mustPage(await query, 'loading applications', locale, {
    page,
    href: (n) => hrefWith('/admin/applications', current, { page: n }),
  });
  const rows = read.data as unknown as ApplicationListRow[];

  const t = await getTranslations('admin');
  const tApplication = await getTranslations('applicationStatus');

  const columns: Column<ApplicationListRow>[] = [
    {
      key: 'candidate',
      header: t('colCandidate'),
      cell: (row) =>
        row.candidate ? (
          <EntityLink href={`/admin/users/${row.candidate.id}`} className="font-medium">
            {row.candidate.full_name}
          </EntityLink>
        ) : (
          '—'
        ),
      mobile: 'title',
    },
    {
      key: 'job',
      header: t('colListing'),
      cell: (row) => (
        <EntityLink href={`/admin/jobs/${row.job.id}`}>{localized(locale, row.job.title_ar, row.job.title_en)}</EntityLink>
      ),
      mobile: 'meta',
    },
    {
      key: 'company',
      header: t('colCompany'),
      cell: (row) =>
        row.job.company ? (
          <EntityLink href={`/admin/companies/${row.job.company.id}`}>
            {localized(locale, row.job.company.name_ar, row.job.company.name_en)}
          </EntityLink>
        ) : (
          '—'
        ),
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
    {
      key: 'actions',
      header: t('colActions'),
      className: 'w-px',
      cell: (row) => {
        if (row.status === 'withdrawn') return null;
        const actions: RowAction[] = PIPELINE_STAGES.filter((status) => status !== row.status).map((status) => ({
          id: status,
          kind: 'lever' as const,
          primary: status === 'shortlisted' && row.status === 'new',
          tone: status === 'rejected' ? ('destructive' as const) : status === 'hired' ? ('success' as const) : undefined,
          label: t('moveApplication', { status: tApplication(status) }),
          title: t('moveApplication', { status: tApplication(status) }),
          body: row.candidate?.full_name,
          icon: status === 'rejected' ? <X aria-hidden /> : status === 'hired' || status === 'shortlisted' ? <Check aria-hidden /> : <Star aria-hidden />,
          lever: { do: 'application' as const, applicationId: row.id, status, from: row.status },
          reason: 'optional' as const,
          reasonLabel: t('reasonToUser'),
        }));
        return <RowActions actions={actions} />;
      },
      mobile: 'meta',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('applications')} lede={t('applicationsLede')} />

      <SearchForm
        locale={locale}
        path="/admin/applications"
        q={q}
        keep={{ status: current.status, job: jobId, candidate: candidateId, day }}
        placeholder={t('applicationsSearchPlaceholder')}
        label={t('search')}
      />

      {jobId || candidateId || day ? (
        <p className="text-sm text-muted-foreground">
          {day && !jobId && !candidateId ? t('filteredToDay') : t('filteredToOne')}{' '}
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
        rowLabel={(row) => row.candidate?.full_name ?? row.id}
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
