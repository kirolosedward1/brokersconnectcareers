import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JobCard } from '@/components/jobs/job-card';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import { formatNumber } from '@/lib/utils';
import type { DistrictRow } from '@/lib/supabase/database.types';
import type { JobListItem } from '@/lib/queries/jobs';

/**
 * Home for a signed-in reader: straight to listings, no pitch. The marketing
 * landing is for people who have not decided yet.
 */
export async function SignedInHome({
  locale,
  districts,
  jobs,
  total,
}: {
  locale: Locale;
  districts: DistrictRow[];
  jobs: JobListItem[];
  total: number;
}) {
  const t = await getTranslations('home');
  const tJobs = await getTranslations('jobs');
  const tTrack = await getTranslations('track');

  const featured = jobs.filter((job) => job.is_featured).slice(0, 2);
  const latest = jobs.filter((job) => !featured.includes(job)).slice(0, 6);
  const openSeats = jobs.reduce((sum, job) => sum + job.seats, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('latestJobs')}</h1>
          <p className="numeral mt-1 text-sm text-muted-foreground">
            {formatNumber(total, locale)} · {t('statJobs')} · {formatNumber(openSeats, locale)}{' '}
            {t('statSeats')}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/jobs">
            {t('browseAll')}
            <ArrowRight className="rtl-flip" />
          </Link>
        </Button>
      </header>

      {featured.length ? (
        <section className="mt-8" aria-labelledby="featured-heading">
          <h2 id="featured-heading" className="text-lg font-semibold">
            {t('featuredJobs')}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {featured.map((job) => (
              <li key={job.id}>
                <JobCard job={job} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="latest-heading">
        <h2 id="latest-heading" className="sr-only">
          {t('latestJobs')}
        </h2>
        {latest.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {latest.map((job) => (
              <li key={job.id}>
                <JobCard job={job} locale={locale} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
            {tJobs('empty')}
          </p>
        )}
      </section>

      <section className="mt-12 grid gap-10 sm:grid-cols-2" aria-label={t('byTrack')}>
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">{t('byTrack')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {JOB_TRACKS.map((track) => (
              <li key={track}>
                <Link href={{ pathname: '/jobs', query: { track } }}>
                  <Badge variant="outline" size="lg">
                    {tTrack(track)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium text-muted-foreground">{t('byDistrict')}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {districts.slice(0, 10).map((district) => (
              <li key={district.id}>
                <Link href={`/jobs/${buildLandingSlug('primary', district.slug)}`}>
                  <Badge variant="outline" size="lg">
                    {localized(locale, district.name_ar, district.name_en)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
