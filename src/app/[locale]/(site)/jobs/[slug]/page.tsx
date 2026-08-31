import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor, localized, routing, type Locale } from '@/i18n/routing';
import { JobDetailView } from '@/components/jobs/job-detail-view';
import { TrackDistrictLanding } from '@/components/jobs/track-district-landing';
import { JsonLd } from '@/components/json-ld';
import { jobPostingJsonLd } from '@/lib/seo/job-posting';
import { getJobBySlug } from '@/lib/queries/jobs';
import { parseLandingSlug } from '@/lib/taxonomy';
import { getDistrictBySlug } from '@/lib/queries/taxonomy';
import { recordJobView } from '@/lib/actions/jobs';
import { truncate, toPlainText } from '@/lib/utils';
import type { DistrictRow, JobTrack } from '@/lib/supabase/database.types';
import type { JobDetail } from '@/lib/queries/jobs';

type Params = { locale: string; slug: string };

/**
 * `/jobs/[slug]` serves two things: a job, and a programmatic
 * `<track>-<district>` landing page. Landing slugs are drawn from a closed
 * taxonomy, and every job slug carries a random suffix, so the two can never
 * collide — the landing form is checked first because it is a pure string
 * match with no database round trip.
 */
type Resolved =
  | { kind: 'landing'; track: JobTrack; district: DistrictRow }
  | { kind: 'job'; job: JobDetail }
  | { kind: 'none' };

async function resolve(slug: string): Promise<Resolved> {
  const landing = parseLandingSlug(slug);
  if (landing) {
    const district = await getDistrictBySlug(landing.districtSlug);
    if (district) return { kind: 'landing', track: landing.track, district };
  }

  const job = await getJobBySlug(slug);
  if (job) return { kind: 'job', job };

  return { kind: 'none' };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const resolved = await resolve(slug);

  if (resolved.kind === 'landing') {
    const t = await getTranslations({ locale, namespace: 'landing' });
    const tTrack = await getTranslations({ locale, namespace: 'track' });
    const track = tTrack(resolved.track);
    const district = localized(locale, resolved.district.name_ar, resolved.district.name_en);

    return {
      title: t('title', { track, district }),
      description: t('subtitle', { track, district }),
      alternates: alternatesFor(`/jobs/${slug}`, locale),
    };
  }

  if (resolved.kind === 'job') {
    const job = resolved.job;
    const title = localized(locale, job.title_ar, job.title_en);
    const company = localized(locale, job.company.name_ar, job.company.name_en);
    const district = localized(locale, job.district.name_ar, job.district.name_en);
    const description = truncate(
      toPlainText(localized(locale, job.description_ar, job.description_en)),
      160,
    );

    return {
      title: `${title} — ${company} — ${district}`,
      description,
      alternates: alternatesFor(`/jobs/${slug}`, locale),
      openGraph: { title, description, type: 'article' },
      // An expired listing must not be indexed as if it were open.
      robots: job.status === 'active' ? undefined : { index: false, follow: true },
    };
  }

  return {};
}

export default async function JobOrLandingPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const resolved = await resolve(slug);

  if (resolved.kind === 'landing') {
    return (
      <TrackDistrictLanding track={resolved.track} district={resolved.district} locale={locale} />
    );
  }

  if (resolved.kind === 'none') notFound();

  const job = resolved.job;
  const isOpen = job.status === 'active' && (!job.expires_at || new Date(job.expires_at) > new Date());

  if (isOpen) {
    // Fire and forget — a failed counter increment must never break the page.
    void recordJobView(slug).catch(() => {});
  }

  return (
    <>
      {/* Structured data only for listings that are genuinely open. */}
      {isOpen ? <JsonLd data={jobPostingJsonLd(job, locale)} /> : null}
      {isOpen ? null : <ClosedNotice />}
      <JobDetailView job={job} locale={locale} />
    </>
  );
}

async function ClosedNotice() {
  const t = await getTranslations('jobs');
  return (
    <div className="border-b border-warning/30 bg-warning-muted">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <p className="text-sm font-medium">{t('expired')}</p>
        <p className="text-sm text-muted-foreground">{t('expiredBody')}</p>
      </div>
    </div>
  );
}
