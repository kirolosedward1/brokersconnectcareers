import { localized } from '@/i18n/routing';
import { env } from '@/lib/env';
import type { JobDetail } from '@/lib/queries/jobs';
import { buildJobPosting } from './job-posting-core';

/**
 * schema.org JobPosting for one listing, mapped from its database row.
 *
 * The mapping and Google's rules live in job-posting-core.ts, which has no
 * framework imports so the test suite can run it directly. This file only
 * resolves the language and the absolute URL.
 *
 * Returns null when the row cannot be described honestly — the page then
 * renders without markup rather than with a broken or stale payload. Only
 * called for listings that are live; see jobIsLive().
 *
 * `governorateName` is passed in rather than looked up here so this stays a
 * pure function; the page already has the taxonomy cached.
 */
export function jobPostingJsonLd(
  job: JobDetail,
  locale: string,
  governorateName: string | null | undefined,
  requirementsHeading?: string,
): Record<string, unknown> | null {
  const path = locale === 'ar' ? `/jobs/${job.slug}` : `/${locale}/jobs/${job.slug}`;

  return buildJobPosting(
    {
      id: job.id,
      url: `${env.siteUrl}${path}`,
      title: localized(locale, job.title_ar, job.title_en),
      description: localized(locale, job.description_ar, job.description_en),
      // Arabic only in the schema; the page shows the same column either way.
      requirements: job.requirements_ar,
      publishedAt: job.published_at,
      expiresAt: job.expires_at,
      employmentType: job.employment_type,
      experienceBand: job.experience_band,
      seats: job.seats,
      salaryMin: job.basic_salary_min,
      salaryMax: job.basic_salary_max,
      company: {
        name: localized(locale, job.company.name_ar, job.company.name_en),
        website: job.company.website,
        logoUrl: job.company.logo_url,
      },
      location: {
        locality: localized(locale, job.district.name_ar, job.district.name_en),
        region: governorateName || null,
      },
    },
    { requirementsHeading },
  );
}
