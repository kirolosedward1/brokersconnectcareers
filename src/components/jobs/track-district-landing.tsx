import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { JobCard } from '@/components/jobs/job-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import { EMPTY_FILTERS, queryJobs } from '@/lib/queries/jobs';
import { getDistricts } from '@/lib/queries/taxonomy';
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

  const [{ jobs, total }, districts] = await Promise.all([
    queryJobs({ ...EMPTY_FILTERS, tracks: [track], districtSlugs: [district.slug] }),
    getDistricts(),
  ]);

  const trackName = tTrack(track);
  const districtName = localized(locale, district.name_ar, district.name_en);

  // Sibling links keep these pages from being orphans and spread crawl budget
  // across the cross product.
  const siblingDistricts = districts.filter((d) => d.id !== district.id).slice(0, 12);
  const siblingTracks = JOB_TRACKS.filter((value) => value !== track);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-balance">
          {t('title', { track: trackName, district: districtName })}
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
          {t('subtitle', { track: trackName, district: districtName })}
        </p>
        <p className="numeral mt-3 text-sm text-muted-foreground">
          {tJobs('resultsCount', { count: total })}
        </p>
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
        <div className="mt-6 rounded-xl border border-dashed border-border py-12 text-center">
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
            {siblingDistricts.map((sibling) => (
              <li key={sibling.id}>
                <Link href={`/jobs/${buildLandingSlug(track, sibling.slug)}`}>
                  <Badge variant="outline" size="lg">
                    {localized(locale, sibling.name_ar, sibling.name_en)}
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
            {siblingTracks.map((sibling) => (
              <li key={sibling}>
                <Link href={`/jobs/${buildLandingSlug(sibling, district.slug)}`}>
                  <Badge variant="outline" size="lg">
                    {tTrack(sibling)}
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
