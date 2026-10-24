import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, localeHref } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { JobCard } from '@/components/jobs/job-card';
import { getJobBySlug, getOtherCompanyJobs, getSimilarJobs } from '@/lib/queries/jobs';
import type { JobDetail, JobListItem } from '@/lib/queries/jobs';

type Params = { locale: string; slug: string };

/**
 * The page an expired listing is rewritten onto, with status 410.
 *
 * The folder is `gone`, not `_gone`: a route segment that starts with `_`
 * is private and Next never serves it.
 *
 * Only the middleware's rewrite arrives here (it sets `x-bc-gone`). Anything
 * else is a miss. There is no loading.tsx on this route, so the status the
 * rewrite set is the status that leaves: a streamed 200 would be the soft
 * answer this exists to avoid.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'jobs' });
  return { title: t('expired'), robots: { index: false, follow: true } };
}

export default async function GoneJobPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  if ((await headers()).get('x-bc-gone') !== '1') notFound();

  const t = await getTranslations('jobs');
  const tHome = await getTranslations('home');
  const tFilters = await getTranslations('filters');

  let job: JobDetail | null = null;
  try {
    job = await getJobBySlug(slug);
  } catch {
    job = null;
  }

  const district = job?.district?.slug ? job.district : null;
  let similar: JobListItem[] = [];
  let companyJobs: JobListItem[] = [];
  if (job?.id && job.track && district) {
    try {
      similar = await getSimilarJobs(job);
    } catch {
      similar = [];
    }
  }
  if (job?.id && job.company_id) {
    try {
      companyJobs = await getOtherCompanyJobs(job.company_id, job.id);
    } catch {
      companyJobs = [];
    }
  }
  const companyName = job ? localized(locale, job.company.name_ar, job.company.name_en) : null;

  const title = job ? localized(locale, job.title_ar, job.title_en) : null;
  const action = localeHref(locale, '/jobs');
  const sameSearch =
    job && district
      ? `/jobs?${new URLSearchParams({ track: job.track, district: district.slug }).toString()}`
      : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-xl text-center">
        <p className="numeral text-sm font-medium text-muted-foreground">410</p>
        <h1 className="mt-1 text-2xl font-bold">{t('expired')}</h1>
        {title ? <p className="mt-2 font-medium">{title}</p> : null}
        <p className="mt-2 text-muted-foreground">{t('expiredBody')}</p>

        <form action={action} className="mt-8 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              placeholder={tHome('searchPlaceholder')}
              aria-label={tHome('searchPlaceholder')}
              className="h-12 w-full rounded-lg border border-input bg-card px-4 ps-11 text-base outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <Button type="submit" size="lg" className="shrink-0 px-8">
            {tHome('searchButton')}
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/jobs">{t('browseOpen')}</Link>
          </Button>
          {sameSearch && district ? (
            <Button asChild variant="outline">
              <Link href={sameSearch}>
                {tFilters('district')}: {localized(locale, district.name_ar, district.name_en)}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {companyJobs.length > 0 && companyName ? (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-bold">{t('otherAtCompany', { company: companyName })}</h2>
          <ul className="space-y-3">
            {companyJobs.map((item) => (
              <li key={item.id}>
                <JobCard job={item} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {similar.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-bold">{t('similarJobs')}</h2>
          <ul className="space-y-3">
            {similar.map((item) => (
              <li key={item.id}>
                <JobCard job={item} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
