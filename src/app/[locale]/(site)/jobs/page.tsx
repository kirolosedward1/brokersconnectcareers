import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SearchX } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { alternatesFor, type Locale } from '@/i18n/routing';
import { JobCard } from '@/components/jobs/job-card';
import { JobFilters, MobileFilters } from '@/components/jobs/job-filters';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { SortSelect } from '@/components/jobs/sort-select';
import { getDistricts, getGovernorates } from '@/lib/queries/taxonomy';
import {
  countActiveFilters,
  parseJobFilters,
  queryJobs,
  serializeJobFilters,
  type SearchParams,
} from '@/lib/queries/jobs';
import { formatNumber } from '@/lib/utils';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const tMeta = await getTranslations({ locale, namespace: 'meta' });

  return {
    title: t('title'),
    description: tMeta('defaultDescription'),
    alternates: alternatesFor('/jobs', locale),
  };
}

export default async function JobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const resolved = await searchParams;
  const filters = parseJobFilters(resolved);
  const activeCount = countActiveFilters(filters);

  const [{ jobs, total, pageCount }, districts, governorates] = await Promise.all([
    queryJobs(filters),
    getDistricts(),
    getGovernorates(),
  ]);

  const t = await getTranslations('jobs');

  const buildHref = (page: number) => {
    const search = serializeJobFilters({ ...filters, page });
    const query = search.toString();
    return query ? `/jobs?${query}` : '/jobs';
  };

  const filterPanel = (
    <JobFilters
      locale={locale}
      districts={districts}
      governorates={governorates}
      activeCount={activeCount}
    />
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="numeral mt-1 text-sm text-muted-foreground">
          {t('resultsCount', { count: total })}
        </p>
      </header>

      <div className="mb-4 lg:hidden">
        <MobileFilters count={activeCount}>{filterPanel}</MobileFilters>
      </div>

      <div className="grid gap-8 lg:grid-cols-[17rem_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pe-2">
            {filterPanel}
          </div>
        </aside>

        <div>
          <div className="mb-4 flex items-center justify-end gap-2">
            <label htmlFor="sort" className="text-sm text-muted-foreground">
              {t('sortBy')}
            </label>
            <SortSelect
              value={filters.sort}
              labels={{
                newest: t('sortNewest'),
                salary: t('sortSalary'),
                seats: t('sortSeats'),
              }}
            />
          </div>

          {jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center">
              <SearchX className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="mt-4 font-medium">{t('empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
              {activeCount > 0 ? (
                <Button asChild variant="outline" className="mt-5">
                  <Link href="/jobs">{t('clearFilters')}</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} locale={locale} />
                  </li>
                ))}
              </ul>

              <Pagination page={filters.page} pageCount={pageCount} buildHref={buildHref} />

              <p className="numeral mt-4 text-center text-xs text-muted-foreground">
                {t('page', { page: formatNumber(filters.page, locale), total: formatNumber(pageCount, locale) })}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
