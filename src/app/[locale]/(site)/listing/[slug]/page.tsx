import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor, localized } from '@/i18n/routing';
import { JobDetailView } from '@/components/jobs/job-detail-view';
import { JsonLd } from '@/components/json-ld';
import { jobPostingJsonLd } from '@/lib/seo/job-posting';
import { jobIsLive, jobIsPublic } from '@/lib/job-state';
import { getJobBySlug } from '@/lib/queries/jobs';
import { fitDescription, fitTitle } from '@/lib/seo/meta-text';
import { env } from '@/lib/env';
import { buildLandingSlug } from '@/lib/taxonomy';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumbs';
import { getGovernorates } from '@/lib/queries/taxonomy';
import { recordJobView } from '@/lib/actions/jobs';
import { formatEgp, toPlainText } from '@/lib/utils';
import type { JobStatus } from '@/lib/supabase/database.types';

type Params = { locale: string; slug: string };

/**
 * A listing, drawn by a rewrite of `/jobs/<slug>`.
 *
 * Dynamic: the owner may be reading a draft, and the view counter runs per
 * request. The public URL stays `/jobs/<slug>`. Landings stay on that segment
 * so they can be cached.
 */
export const dynamic = 'force-dynamic';

const OG_IMAGE = { url: '/brand/og.jpg', width: 1200, height: 630 } as const;

function pageUrl(locale: string, path: string): string {
  return `${env.siteUrl}${locale === 'ar' ? '' : `/${locale}`}${path}`;
}

const isOpen = jobIsLive;

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const district = localized(locale, job.district.name_ar, job.district.name_en);
  const tComp = await getTranslations({ locale, namespace: 'compensation' });
  const tLeads = await getTranslations({ locale, namespace: 'leadsSource' });
  const tCommon = await getTranslations({ locale, namespace: 'common' });

  const money =
    job.basic_salary_min != null && job.basic_salary_max != null
      ? `${formatEgp(job.basic_salary_min, locale)} – ${formatEgp(job.basic_salary_max, locale)} ${tCommon('egp')} ${tComp('perMonth')}`
      : job.basic_salary_min != null
        ? `${formatEgp(job.basic_salary_min, locale)}+ ${tCommon('egp')} ${tComp('perMonth')}`
        : job.basic_salary_max != null
          ? `${tComp('upTo')} ${formatEgp(job.basic_salary_max, locale)} ${tCommon('egp')} ${tComp('perMonth')}`
          : tComp(job.commission_type === 'none' ? 'noBasicSalary' : 'commissionOnly');

  const facts = [money, tLeads(`${job.leads_source}_short`), district].join(' · ');
  const prose = toPlainText(localized(locale, job.description_ar, job.description_en));
  const tMeta = await getTranslations({ locale, namespace: 'meta' });
  const description = fitDescription(`${facts} — ${prose}`, tMeta('descriptionPad'));
  const absoluteTitle = fitTitle(`${title} — ${company} — ${district}`, 60);
  const path = `/jobs/${slug}`;

  return {
    title: { absolute: absoluteTitle },
    description,
    alternates: alternatesFor(path, locale),
    openGraph: {
      title: fitTitle(`${title} — ${company}`, 60),
      description,
      type: 'article',
      url: pageUrl(locale, path),
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      images: [{ ...OG_IMAGE, alt: tMeta('tagline') }],
    },
    robots: isOpen(job)
      ? {
          index: true,
          follow: true,
          ...(job.expires_at
            ? { unavailable_after: new Date(job.expires_at).toUTCString() }
            : {}),
        }
      : { index: false, follow: true },
  };
}

export default async function ListingPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const open = isOpen(job);
  const published = jobIsPublic(job);

  if (open) {
    after(() => recordJobView(slug).catch(() => {}));
  }

  const governorates = await getGovernorates();
  const governorate = governorates.find((item) => item.id === job.district.governorate_id);
  const governorateName = governorate
    ? localized(locale, governorate.name_ar, governorate.name_en)
    : null;

  const tJobs = await getTranslations('jobs');
  const tTrack = await getTranslations('track');
  const tLanding = await getTranslations('landing');
  const districtName = localized(locale, job.district.name_ar, job.district.name_en);

  const posting = open
    ? jobPostingJsonLd(job, locale, governorateName, tJobs('requirements'))
    : null;

  return (
    <>
      {posting ? <JsonLd data={posting} /> : null}
      <JsonLd
        data={breadcrumbJsonLd(
          [
            { name: tJobs('title'), path: '/jobs' },
            {
              name: tLanding('title', { track: tTrack(job.track), district: districtName }),
              path: `/jobs/${buildLandingSlug(job.track, job.district.slug)}`,
            },
            { name: localized(locale, job.title_ar, job.title_en) },
          ],
          locale,
        )}
      />
      {open ? null : published ? <ClosedNotice /> : <UnpublishedNotice status={job.status} />}
      <JobDetailView job={job} locale={locale} open={open} published={published} />
    </>
  );
}

async function UnpublishedNotice({ status }: { status: JobStatus }) {
  const t = await getTranslations('jobs');
  const tStatus = await getTranslations('jobStatus');
  return (
    <div className="border-b border-border bg-muted">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <p className="text-sm font-medium">{t('notPublished')}</p>
        <p className="text-sm text-muted-foreground">{t('notPublishedBody', { status: tStatus(status) })}</p>
      </div>
    </div>
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
