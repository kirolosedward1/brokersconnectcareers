import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, localized } from '@/i18n/routing';
import { AdminTable, FilterTabs, Num, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { VerificationBadge } from '@/components/admin/badges';
import { CompanyLogo } from '@/components/companies/company-logo';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mustPage } from '@/lib/admin/read';
import { PAGE_SIZE, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { likeNeedle } from '@/lib/search/needle';
import { formatDate } from '@/lib/utils';
import type { CompanyRow } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('companiesQueue'), robots: { index: false, follow: false } };
}

const FILTERS = ['pending', 'verified', 'unverified', 'rejected', 'suspended', 'all'] as const;

type CompanyListRow = Pick<
  CompanyRow,
  'id' | 'name_ar' | 'name_en' | 'slug' | 'logo_url' | 'verification_status' | 'suspended_at' | 'created_at'
> & { jobs: { count: number }[]; company_members: { count: number }[] };

/**
 * Every company, with the verification queue as the first tab.
 *
 * The queue is oldest-first — the company that has waited longest is the one
 * to read next — and every other view newest-first. Searching reaches names in
 * both languages and the slug, through trigram indexes rather than a scan.
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
  const status = oneOf(param(sp, 'status'), FILTERS, 'pending');
  const page = pageOf(sp);
  const [from, to] = rangeOf(page);

  const supabase = await createClient();
  let query = supabase
    .from('companies')
    .select(
      `id, name_ar, name_en, slug, logo_url, verification_status, suspended_at, created_at, jobs (count), company_members (count)${
        status === 'pending' ? ', company_documents!inner (id)' : ''
      }`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: status === 'pending' })
    .order('id')
    .range(from, to);

  if (status === 'suspended') query = query.not('suspended_at', 'is', null);
  else if (status !== 'all') {
    query = query.eq('verification_status', status);
    if (status === 'pending') query = query.eq('company_documents.status', 'pending');
  }

  const needle = q ? likeNeedle(q) : '';
  if (needle) query = query.or(`name_ar.ilike.*${needle}*,name_en.ilike.*${needle}*,slug.ilike.*${needle}*`);

  const read = await mustPage(await query, 'loading companies', locale, {
    page,
    href: (n) => hrefWith('/admin/companies', { q, status: status === 'pending' ? undefined : status }, { page: n }),
  });
  const rows = read.data as unknown as CompanyListRow[];

  const t = await getTranslations('admin');
  const current = { q, status: status === 'pending' ? undefined : status };

  const columns: Column<CompanyListRow>[] = [
    {
      key: 'name',
      header: t('colName'),
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          <CompanyLogo logoUrl={row.logo_url} seed={row.slug} name={localized(locale, row.name_ar, row.name_en)} size="sm" />
          {localized(locale, row.name_ar, row.name_en)}
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
        keep={{ status: current.status }}
        placeholder={t('companiesSearchPlaceholder')}
        label={t('search')}
      />

      <FilterTabs
        label={t('colStatus')}
        items={FILTERS.map((value) => ({
          key: value,
          label:
            value === 'all' ? t('filterAll') : value === 'suspended' ? t('suspended') : t(`verification.${value}`),
          href: hrefWith('/admin/companies', current, { status: value === 'pending' ? undefined : value }),
          active: status === value,
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
        total={read.count}
        size={PAGE_SIZE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/companies', current, { page: next })}
      />
    </div>
  );
}
