import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SearchX } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, alternatesFor, localized, type Locale } from '@/i18n/routing';
import { JobCard } from '@/components/jobs/job-card';
import { CompanyLogo } from '@/components/companies/company-logo';
import { JobFilters } from '@/components/jobs/job-filters';
import { MobileFilters } from '@/components/mobile-filters';
import { SaveSearch } from '@/components/jobs/save-search';
import { getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { SortSelect } from '@/components/jobs/sort-select';
import { getDistricts, getGovernorates } from '@/lib/queries/taxonomy';
import { getCompanyBySlug } from '@/lib/queries/companies';
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
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
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
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const resolved = await searchParams;
  const filters = parseJobFilters(resolved);
  const activeCount = countActiveFilters(filters);

  const [{ jobs, total, pageCount, page }, districts, governorates, viewer] = await Promise.all([
    queryJobs(filters),
    getDistricts(),
    getGovernorates(),
    getViewer(),
  ]);

  /**
   * Which of these the reader has already applied to or saved.
   *
   * Two small reads keyed to the ids on this page, not a join on the listing
   * query — the board is public and cached per filter, and folding a
   * per-reader column into it would make every result set personal.
   *
   * Skipped entirely for a signed-out visitor, who has no answer to give.
   */
  const jobIds = jobs.map((job) => job.id);
  let appliedIds = new Set<string>();
  let savedIds = new Set<string>();

  if (viewer?.profile && jobIds.length) {
    const supabase = await createClient();
    const [{ data: applied }, { data: saved }] = await Promise.all([
      supabase.from('applications').select('job_id').in('job_id', jobIds),
      supabase.from('saved_jobs').select('job_id').in('job_id', jobIds),
    ]);
    // Row-level security scopes both to this reader; no candidate_id filter is
    // written here, for the same reason it is not written on the inbox.
    appliedIds = new Set((applied ?? []).map((row) => row.job_id));
    savedIds = new Set((saved ?? []).map((row) => row.job_id));
  }

  /*
    The company the board is pinned to, if any.

    Serial rather than folded into the batch above, because it only happens on
    the one path that asks for it — a follow's link, or the company page's own
    "see all roles". The row is cached per request, so the banner and anything
    else that wants the name share a single read.
  */
  const pinnedCompany = filters.companySlug ? await getCompanyBySlug(filters.companySlug) : null;

  const t = await getTranslations('jobs');
  const tTrack = await getTranslations('track');

  // A name the reader would recognise in a list a month from now. Their own
  // search words if they typed any, otherwise the filters that narrowed it.
  const defaultSearchLabel = (() => {
    // A board pinned to one brokerage is a follow; name it after the brokerage
    // so the saved row and the weekly mail both say what it is.
    if (pinnedCompany) return localized(locale, pinnedCompany.name_ar, pinnedCompany.name_en);
    if (filters.q) return filters.q;
    const parts: string[] = [];
    if (filters.tracks[0]) parts.push(tTrack(filters.tracks[0]));
    const district = districts.find((item) => item.slug === filters.districtSlugs[0]);
    if (district) parts.push(localized(locale, district.name_ar, district.name_en));
    return parts.join(' · ') || t('title');
  })();

  const buildHref = (page: number, overrides: Partial<typeof filters> = {}) => {
    const search = serializeJobFilters({ ...filters, ...overrides, page });
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
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('resultsCount', { count: total })}
          </p>
        </div>

        {/* Only once the reader has narrowed something down. Offering to save an
            unfiltered list is offering to email them the whole board weekly. */}
        {activeCount > 0 ? (
          <SaveSearch signedIn={Boolean(viewer)} defaultLabel={defaultSearchLabel} />
        ) : null}
      </header>

      {pinnedCompany ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <CompanyLogo
            name={localized(locale, pinnedCompany.name_ar, pinnedCompany.name_en)}
            logoUrl={pinnedCompany.logo_url}
            seed={pinnedCompany.slug}
          />

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {t('atCompany', {
                company: localized(locale, pinnedCompany.name_ar, pinnedCompany.name_en),
              })}
            </p>
            <Link
              href={`/companies/${pinnedCompany.slug}`}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              {t('companyPage')}
            </Link>
          </div>

          {/* Page reset with it: leaving the company behind on page 3 of its
              listings lands on page 3 of the whole board. */}
          <Button asChild variant="ghost" size="sm">
            <Link href={buildHref(1, { companySlug: null })}>{t('allCompanies')}</Link>
          </Button>
        </div>
      ) : null}

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
              {/* The results are their own region, and each card's title is an
                  h3 — so without this the page jumps h1 to h3 and a screen
                  reader's heading list has a hole where "the results" should
                  be. Visually silent because the count above already says it. */}
              <h2 className="sr-only">{t('resultsCount', { count: total })}</h2>

              <ul className="space-y-3">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard
                      job={job}
                      locale={locale}
                      applied={appliedIds.has(job.id)}
                      saved={savedIds.has(job.id)}
                      savable={viewer?.profile?.role === 'candidate'}
                    />
                  </li>
                ))}
              </ul>

              <Pagination page={page} pageCount={pageCount} buildHref={buildHref} />

              <p className="mt-4 text-center text-xs text-muted-foreground">
                {t('page', { page: formatNumber(page, locale), total: formatNumber(pageCount, locale) })}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
