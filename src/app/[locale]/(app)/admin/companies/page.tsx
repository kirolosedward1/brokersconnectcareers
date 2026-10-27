import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, localized } from '@/i18n/routing';
import { AdminTable, FilterTabs, Num, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { VerificationBadge } from '@/components/admin/badges';
import { TestBadge } from '@/components/admin/crm';
import { CompanyLogo } from '@/components/companies/company-logo';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mustPage } from '@/lib/admin/read';
import { PAGE_SIZE, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { looseArabicNeedle } from '@/lib/search/needle';
import { formatDate } from '@/lib/utils';
import type { CompanyRow } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('companiesQueue'), robots: { index: false, follow: false } };
}

const FILTERS = ['all', 'pending', 'verified', 'unverified', 'rejected', 'suspended'] as const;
const TEST = ['all', 'hide', 'only'] as const;

type CompanyListRow = Pick<
  CompanyRow,
  'id' | 'name_ar' | 'name_en' | 'slug' | 'logo_url' | 'verification_status' | 'suspended_at' | 'created_at'
> & { is_test?: boolean; jobs: { count: number }[]; company_members: { count: number }[] };

/**
 * Every company. «الكل» is first and selected until a filter is chosen.
 *
 * The waiting queue is oldest-first — the company that has waited longest is
 * the one to read next — and every other view newest-first. Searching reaches
 * names in both languages and the slug, through trigram indexes rather than a scan.
 */
export default async function AdminCompaniesPage({
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
  const status = oneOf(param(sp, 'status'), FILTERS, 'all');
  const test = oneOf(param(sp, 'test'), TEST, 'all');
  const page = pageOf(sp);
  const [from, to] = rangeOf(page);

  const supabase = await createClient();
  const columnsFor = (withTest: boolean) =>
    `id, name_ar, name_en, slug, logo_url, verification_status, suspended_at, created_at${withTest ? ', is_test' : ''}, jobs (count), company_members (count)${
      status === 'pending' ? ', company_documents!inner (id)' : ''
    }`;
  const build = (withTest: boolean) => {
    let query = supabase
      .from('companies')
      .select(columnsFor(withTest), { count: 'exact' })
      .order('created_at', { ascending: status === 'pending' })
      .order('id')
      .range(from, to);
    if (status === 'suspended') query = query.not('suspended_at', 'is', null);
    else if (status !== 'all') {
      query = query.eq('verification_status', status);
      if (status === 'pending') query = query.eq('company_documents.status', 'pending');
    }
    if (withTest && test === 'hide') query = query.eq('is_test', false);
    if (withTest && test === 'only') query = query.eq('is_test', true);
    const needle = q ? looseArabicNeedle(q) : '';
    if (needle) query = query.or(`name_ar.ilike.*${needle}*,name_en.ilike.*${needle}*,slug.ilike.*${needle}*`);
    return query;
  };

  const current = {
    q,
    status: status === 'all' ? undefined : status,
    test: test === 'all' ? undefined : test,
  };
  let read = await build(true);
  if (read.error?.code === '42703' || read.error?.code === 'PGRST204') read = await build(false);
  const pageRead = await mustPage(read, 'loading companies', locale, {
    page,
    href: (n) => hrefWith('/admin/companies', current, { page: n }),
  });
  const rows = pageRead.data as unknown as CompanyListRow[];

  const t = await getTranslations('admin');

  const columns: Column<CompanyListRow>[] = [
    {
      key: 'name',
      header: t('colName'),
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <CompanyLogo logoUrl={row.logo_url} seed={row.slug} name={localized(locale, row.name_ar, row.name_en)} size="sm" />
          {localized(locale, row.name_ar, row.name_en)}
          {row.is_test ? <TestBadge /> : null}
        </span>
      ),
      mobile: 'title',
    },
    { key: 'jobs', header: t('colListings'), cell: (row) => <Num value={row.jobs[0]?.count ?? 0} locale={locale} />, mobile: 'meta' },
    {
      key: 'members',
      header: t('colMembers'),
      cell: (row) => <Num value={row.company_members[0]?.count ?? 0} locale={locale} />,
      mobile: 'hidden',
    },
    { key: 'joined', header: t('colJoined'), cell: (row) => formatDate(row.created_at, locale), mobile: 'meta' },
    {
      key: 'status',
      header: t('colStatus'),
      cell: (row) => <VerificationBadge status={row.verification_status} suspended={Boolean(row.suspended_at)} />,
      mobile: 'aside',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('companiesQueue')} lede={t('companiesQueueLede')} />

      <SearchForm
        locale={locale}
        path="/admin/companies"
        q={q}
        keep={{ status: current.status, test: current.test }}
        placeholder={t('companiesSearchPlaceholder')}
        label={t('search')}
      />

      <FilterTabs
        label={t('colStatus')}
        items={FILTERS.map((value) => ({
          key: value,
          label:
            value === 'all' ? t('filterAll') : value === 'suspended' ? t('suspended') : t(`verification.${value}`),
          href: hrefWith('/admin/companies', current, { status: value === 'all' ? undefined : value }),
          active: status === value,
        }))}
      />
      <FilterTabs
        label={t('testBadge')}
        items={TEST.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAll') : value === 'hide' ? t('hideTest') : t('onlyTest'),
          href: hrefWith('/admin/companies', current, { test: value === 'all' ? undefined : value }),
          active: test === value,
        }))}
      />

      <AdminTable
        caption={t('companiesQueue')}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={(row) => `/admin/companies/${row.id}`}
        empty={q ? t('searchNothing') : t('emptyQueue')}
      />

      <Pager
        page={page}
        total={pageRead.count}
        size={PAGE_SIZE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/companies', current, { page: next })}
      />
    </div>
  );
}
