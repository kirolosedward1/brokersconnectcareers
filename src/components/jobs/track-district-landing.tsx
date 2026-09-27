import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { JobCard } from '@/components/jobs/job-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import { EMPTY_FILTERS, queryJobs } from '@/lib/queries/jobs';
import { getDistricts } from '@/lib/queries/taxonomy';
import { getBrowseCounts, getLandingFacts } from '@/lib/queries/browse';
import { optional } from '@/lib/queries/error';
import { JsonLd } from '@/components/json-ld';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumbs';
import { formatEgp, formatNumber } from '@/lib/utils';
import type { DistrictRow, JobTrack } from '@/lib/supabase/database.types';

/**
 * Programmatic landing page for one point of the track x district cross
 * product. These are the organic traffic engine: someone searching
 * "وظائف بيع أول التجمع الخامس" lands here rather than on a filtered board URL
 * that search engines treat as a duplicate.
 */
export async function TrackDistrictLanding({
  track,
  district,
  locale,
}: {
  track: JobTrack;
  district: DistrictRow;
  locale: Locale;
}) {
  const t = await getTranslations('landing');
  const tJobs = await getTranslations('jobs');
  const tTrack = await getTranslations('track');

  const [{ jobs, total }, districts, counts, facts] = await Promise.all([
    queryJobs({ ...EMPTY_FILTERS, tracks: [track], districtSlugs: [district.slug] }),
    getDistricts(),
    // Both allowed to fail: without them the page is still its listings.
    optional(getBrowseCounts(), null),
    optional(getLandingFacts(track, district.id), null),
  ]);

  const trackName = tTrack(track);
  const districtName = localized(locale, district.name_ar, district.name_en);

  /*
    Sibling links go where there is something to find.

    These were the first twelve districts in the table and every other track,
    whether or not anything was open there — so most of what a landing linked
    to was an empty, noindexed page, and crawl budget went on exactly the
    pages the sitemap had deliberately left out. Now the pairs with live
    listings come first, busiest first; the rest of the taxonomy follows only
    to fill the row, so the links stay stable on a quiet day.
  */
  const live = new Map((counts?.pairs ?? []).map((pair) => [`${pair.track}:${pair.districtId}`, pair.count]));
  const liveCount = (t: JobTrack, districtId: number) => live.get(`${t}:${districtId}`) ?? 0;

  const siblingDistricts = districts
    .filter((d) => d.id !== district.id)
    .map((d) => ({ district: d, count: liveCount(track, d.id) }))
    .sort((a, b) => b.count - a.count)
    .filter((item, index) => item.count > 0 || index < 6)
    .slice(0, 12);
  const siblingTracks = JOB_TRACKS.filter((value) => value !== track)
    .map((value) => ({ track: value, count: liveCount(value, district.id) }))
    .sort((a, b) => b.count - a.count);

  const factLines: string[] = [];
  if (facts && facts.listings > 0) {
    factLines.push(t('companiesHiring', { count: facts.companies }));
    if (facts.withBasicSalary > 0) {
      factLines.push(
        t('withSalary', {
          count: formatNumber(facts.withBasicSalary, locale),
          total: formatNumber(facts.listings, locale),
        }),
      );
      if (facts.salaryFloor != null && facts.salaryCeiling != null && facts.salaryCeiling > facts.salaryFloor) {
        factLines.push(
          t('factSalaryRange', {
            min: formatEgp(facts.salaryFloor, locale),
            max: formatEgp(facts.salaryCeiling, locale),
          }),
        );
      } else if (facts.salaryFloor != null) {
        factLines.push(t('factSalaryFrom', { min: formatEgp(facts.salaryFloor, locale) }));
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <JsonLd
        data={breadcrumbJsonLd(
          [
            { name: tJobs('title'), path: '/jobs' },
            { name: t('title', { track: trackName, district: districtName }) },
          ],
          locale,
        )}
      />
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-muted-foreground">
        <Link href="/jobs" className="hover:text-foreground">
          {tJobs('title')}
        </Link>
        <span className="mx-2" aria-hidden>
          /
        </span>
        <span aria-current="page">{t('title', { track: trackName, district: districtName })}</span>
      </nav>
      <header>
        <h1 className="text-2xl font-bold text-balance">
          {t('title', { track: trackName, district: districtName })}
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
          {t('subtitle', { track: trackName, district: districtName })}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {tJobs('resultsCount', { count: total })}
        </p>
        {factLines.length ? (
          <ul aria-label={t('factsLabel')} className="mt-3 flex flex-wrap gap-2 text-sm">
            {factLines.map((line) => (
              <li key={line} className="rounded-md border border-border bg-card px-2.5 py-1">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {jobs.length ? (
        <ul className="mt-6 space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <JobCard job={job} locale={locale} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-8 text-center">
          <p className="font-medium">{tJobs('empty')}</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/jobs">{tJobs('title')}</Link>
          </Button>
        </div>
      )}

      {total > jobs.length ? (
        <div className="mt-6 text-center">
          <Button asChild variant="outline">
            <Link href={{ pathname: '/jobs', query: { track, district: district.slug } }}>
              {tJobs('title')}
            </Link>
          </Button>
        </div>
      ) : null}

      <nav className="mt-14 space-y-6 border-t border-border pt-8">
        <div>
          <h2 className="text-sm font-semibold">
            {t('otherDistricts', { track: trackName })}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {siblingDistricts.map(({ district: sibling, count }) => (
              <li key={sibling.id}>
                <Link href={`/jobs/${buildLandingSlug(track, sibling.slug)}`}>
                  <Badge variant="outline" size="lg">
                    {localized(locale, sibling.name_ar, sibling.name_en)}
                    {count > 0 ? <span className="numeral text-muted-foreground">{formatNumber(count, locale)}</span> : null}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold">
            {t('otherTracks', { district: districtName })}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {siblingTracks.map(({ track: sibling, count }) => (
              <li key={sibling}>
                <Link href={`/jobs/${buildLandingSlug(sibling, district.slug)}`}>
                  <Badge variant="outline" size="lg">
                    {tTrack(sibling)}
                    {count > 0 ? <span className="numeral text-muted-foreground">{formatNumber(count, locale)}</span> : null}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}
