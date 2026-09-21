import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SearchX, X } from 'lucide-react';
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
  EMPTY_FILTERS,
  countActiveFilters,
  parseJobFilters,
  queryJobs,
  serializeJobFilters,
  type SearchParams,
} from '@/lib/queries/jobs';
import { formatNumber } from '@/lib/utils';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const tMeta = await getTranslations({ locale, namespace: 'meta' });

  /*
    A filtered board is a view, not a page.

    The canonical below already points every combination back at /jobs, but a
    canonical is a hint and the home page now links straight into filtered
    views — by track, by district. Eleven tracks by forty districts by three
    lead sources is thousands of thin URLs a crawler could reach from the front
    door. So anything narrowed, sorted or paged says so outright: follow the
    links, do not index the view. The pages meant to rank for "primary sales
    jobs in New Cairo" are the track-and-district landings, which have clean
    URLs and copy of their own.
  */
  const filters = parseJobFilters(await searchParams);
  const isView =
    countActiveFilters(filters) > 0 || filters.sort !== 'newest' || filters.page > 1;

  return {
    title: t('title'),
    description: tMeta('defaultDescription'),
    alternates: alternatesFor('/jobs', locale),
    ...(isView ? { robots: { index: false, follow: true } } : {}),
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

  /*
    Who is offered a saved search.

    Candidates, and readers who are not signed in — the control points those at
    sign-in with a `next` back to the search they built, which is the only way
    somebody without an account finds out the feature exists.

    Nobody else. What "Alert me" writes is a saved search, which is a
    candidate's row: /dashboard/saved is the one page that lists it and it
    turns employers away, and the weekly digest it feeds is written for
    somebody looking for work. An account still mid-onboarding has no profile
    row yet and so no row to own one, which is the other case this excludes.
  */
  const offerSavedSearch = !viewer || viewer.profile?.role === 'candidate';

  const t = await getTranslations('jobs');
  const tTrack = await getTranslations('track');
  const tLeads = await getTranslations('leadsSource');
  const tExp = await getTranslations('experienceBand');
  const tType = await getTranslations('employmentType');
  const tFilters = await getTranslations('filters');
  const tCompanyType = await getTranslations('companyType');

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

  /*
    What the board is currently narrowed by, one removable token each.

    The rail shows the same state as ticked boxes, but the rail is a drawer on
    a phone and scrolls out of view on a desktop — and a reader who arrives
    from the home page's "browse by district" never touched it at all. They
    need to see why this list is short and be able to undo exactly that.

    Links, not buttons: each is the URL of the board without that one filter,
    so it works before hydration and the back button undoes it. The pinned
    company is left out because the banner above already names it and carries
    its own way back.
  */
  const districtLabel = (slug: string) => {
    const district = districts.find((item) => item.slug === slug);
    return district ? localized(locale, district.name_ar, district.name_en) : slug;
  };
  const governorate = governorates.find((item) => item.slug === filters.governorateSlug);

  const activeFilters: { key: string; label: string; href: string }[] = [
    ...(filters.q ? [{ key: 'q', label: `«${filters.q}»`, href: buildHref(1, { q: '' }) }] : []),
    ...filters.tracks.map((value) => ({
      key: `track-${value}`,
      label: tTrack(value),
      href: buildHref(1, { tracks: filters.tracks.filter((item) => item !== value) }),
    })),
    ...filters.districtSlugs.map((value) => ({
      key: `district-${value}`,
      label: districtLabel(value),
      href: buildHref(1, { districtSlugs: filters.districtSlugs.filter((item) => item !== value) }),
    })),
    ...(filters.governorateSlug
      ? [
          {
            key: 'gov',
            label: governorate
              ? localized(locale, governorate.name_ar, governorate.name_en)
              : filters.governorateSlug,
            href: buildHref(1, { governorateSlug: null }),
          },
        ]
      : []),
    ...filters.companyTypes.map((value) => ({
      key: `ctype-${value}`,
      label: tCompanyType(value),
      href: buildHref(1, { companyTypes: filters.companyTypes.filter((item) => item !== value) }),
    })),
    ...filters.leadsSources.map((value) => ({
      key: `leads-${value}`,
      label: tLeads(`${value}_short`),
      href: buildHref(1, { leadsSources: filters.leadsSources.filter((item) => item !== value) }),
    })),
    ...(filters.hasBasicSalary === null
      ? []
      : [
          {
            key: 'salary',
            label: tFilters(filters.hasBasicSalary ? 'hasBasicSalaryYes' : 'hasBasicSalaryNo'),
            href: buildHref(1, { hasBasicSalary: null }),
          },
        ]),
    ...filters.experienceBands.map((value) => ({
      key: `exp-${value}`,
      label: tExp(value),
      href: buildHref(1, {
        experienceBands: filters.experienceBands.filter((item) => item !== value),
      }),
    })),
    ...filters.employmentTypes.map((value) => ({
      key: `type-${value}`,
      label: tType(value),
      href: buildHref(1, {
        employmentTypes: filters.employmentTypes.filter((item) => item !== value),
      }),
    })),
  ];

  const filterPanel = (
    <JobFilters
      locale={locale}
      districts={districts}
      governorates={governorates}
      activeCount={activeCount}
    />
  );

  return (
    <div className="shell py-6">
      {/*
        One line: what this is, how many, and how it is ordered.

        These were three rows — a title, a count under it, and further down a
        sort control alone on a line of its own — which put the first listing
        a third of the way down a laptop screen. The count is a property of the
        title and the sort is a property of the count, so they share a baseline.
      */}
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <p className="text-sm whitespace-nowrap text-muted-foreground">
            {t('resultsCount', { count: total })}
          </p>
        </div>

        {/* Only once the reader has narrowed something down. Offering to save an
            unfiltered list is offering to email them the whole board weekly.

            And only to the side of the market it was built for — the same test
            the bookmark on each card below already applies. An employer who
            pressed this got a row that no page of theirs lists and a weekly
            email they had no switch for. */}
        {activeCount > 0 && offerSavedSearch ? (
          <SaveSearch signedIn={Boolean(viewer)} defaultLabel={defaultSearchLabel} />
        ) : null}

        <div className="flex items-center gap-2">
          {/* Heard on a phone, not seen: the select's own value — "newest" —
              says what it is, and the visible label was what pushed the count
              onto two lines at 360px. */}
          <label htmlFor="sort" className="text-sm text-muted-foreground max-sm:sr-only">
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
      </header>

      {pinnedCompany ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
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

      <div className="grid gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pe-2">
            {filterPanel}
          </div>
        </aside>

        <div className="min-w-0">
          {activeFilters.length ? (
            <ul
              aria-label={t('filters')}
              className="mb-3 flex flex-wrap items-center gap-1.5 text-sm"
            >
              {activeFilters.map((filter) => (
                <li key={filter.key}>
                  <Link
                    href={filter.href}
                    scroll={false}
                    aria-label={t('removeFilter', { name: filter.label })}
                    className="inline-flex min-h-8 items-center gap-1 rounded-md border border-primary/25 bg-primary/[0.06] ps-2 pe-1.5 text-[13px] font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/10"
                  >
                    <bdi>{filter.label}</bdi>
                    <X className="size-3.5 opacity-70" aria-hidden />
                  </Link>
                </li>
              ))}
              {activeFilters.length > 1 ? (
                <li>
                  <Link
                    href={pinnedCompany ? buildHref(1, { ...EMPTY_FILTERS, companySlug: filters.companySlug }) : '/jobs'}
                    scroll={false}
                    className="inline-flex min-h-8 items-center px-1.5 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {t('clearFilters')}
                  </Link>
                </li>
              ) : null}
            </ul>
          ) : null}

          {jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
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

              <ul className="space-y-2">
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

              {/* "Page 1 of 1" under a single listing is a sentence about
                  nothing. Said only when there is somewhere else to go. */}
              {pageCount > 1 ? (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  {t('page', { page: formatNumber(page, locale), total: formatNumber(pageCount, locale) })}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
