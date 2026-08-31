import { localized } from '@/i18n/routing';
import { env } from '@/lib/env';
import { isoDate, toPlainText } from '@/lib/utils';
import type { EmploymentType } from '@/lib/supabase/database.types';
import type { JobDetail } from '@/lib/queries/jobs';

const EMPLOYMENT_TYPE: Record<EmploymentType, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  // Commission-only work is contractor work in schema.org's vocabulary; there
  // is no closer term, and CONTRACTOR is what aggregators expect.
  freelance_commission_only: 'CONTRACTOR',
};

/**
 * schema.org JobPosting for Google Jobs. Only emitted for listings that are
 * actually open — marking up an expired post is a structured-data violation.
 */
export function jobPostingJsonLd(job: JobDetail, locale: string) {
  const title = localized(locale, job.title_ar, job.title_en);
  const description = localized(locale, job.description_ar, job.description_en);
  const companyName = localized(locale, job.company.name_ar, job.company.name_en);
  const districtName = localized(locale, job.district.name_ar, job.district.name_en);

  const path = locale === 'ar' ? `/jobs/${job.slug}` : `/${locale}/jobs/${job.slug}`;

  const requirements = job.requirements_ar ? toPlainText(job.requirements_ar) : undefined;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title,
    description: toPlainText(description),
    identifier: {
      '@type': 'PropertyValue',
      name: companyName,
      value: job.id,
    },
    datePosted: isoDate(job.published_at),
    validThrough: isoDate(job.expires_at),
    employmentType: EMPLOYMENT_TYPE[job.employment_type],
    industry: 'Real Estate',
    directApply: true,
    url: `${env.siteUrl}${path}`,
    hiringOrganization: {
      '@type': 'Organization',
      name: companyName,
      sameAs: job.company.website ?? `${env.siteUrl}/companies/${job.company.slug}`,
      ...(job.company.logo_url ? { logo: job.company.logo_url } : {}),
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: districtName,
        addressRegion: districtName,
        addressCountry: 'EG',
      },
    },
    ...(job.seats > 1 ? { totalJobOpenings: job.seats } : {}),
    ...(requirements ? { experienceRequirements: requirements } : {}),
  };

  // baseSalary is only honest when there is a basic salary. Commission-only
  // roles omit it rather than reporting zero.
  if (job.basic_salary_min != null || job.basic_salary_max != null) {
    jsonLd.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'EGP',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.basic_salary_min != null ? { minValue: job.basic_salary_min } : {}),
        ...(job.basic_salary_max != null ? { maxValue: job.basic_salary_max } : {}),
        unitText: 'MONTH',
      },
    };
  }

  return jsonLd;
}
