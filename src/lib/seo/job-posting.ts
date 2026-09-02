import { localized } from '@/i18n/routing';
import { env } from '@/lib/env';
import { isoDate, toPlainText } from '@/lib/utils';
import type { EmploymentType, ExperienceBand } from '@/lib/supabase/database.types';
import type { JobDetail } from '@/lib/queries/jobs';

const EMPLOYMENT_TYPE: Record<EmploymentType, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  // Commission-only work is contractor work in schema.org's vocabulary; there
  // is no closer term, and CONTRACTOR is what aggregators expect.
  freelance_commission_only: 'CONTRACTOR',
};

/**
 * The floor of each band, in months.
 *
 * Google reads experience as a number and filters on it. A band expressed only
 * as prose is a band Google cannot filter by, so the lower bound is published
 * as a number — the lower bound rather than the midpoint, because it is the
 * requirement, not the expectation.
 */
const MONTHS_OF_EXPERIENCE: Record<ExperienceBand, number> = {
  fresh_0_1: 0,
  junior_1_3: 12,
  mid_3_5: 36,
  senior_5_plus: 60,
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Google asks for the description in HTML and renders it in the job panel.
 * Our descriptions are stored as text with blank lines between paragraphs, so
 * this preserves that one piece of structure and escapes everything else —
 * the text is employer-supplied and goes into a document, not a page.
 */
function toDescriptionHtml(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((block) => escapeHtml(toPlainText(block)))
    .filter(Boolean);

  // A description with no blank lines is still one paragraph, not nothing.
  return paragraphs.length
    ? paragraphs.map((p) => `<p>${p}</p>`).join('')
    : `<p>${escapeHtml(toPlainText(text))}</p>`;
}

/**
 * schema.org JobPosting for Google Jobs. Only emitted for listings that are
 * actually open — marking up an expired post is a structured-data violation.
 *
 * `governorateName` is passed in rather than looked up here so this stays a
 * pure function; the page already has the taxonomy cached.
 */
export function jobPostingJsonLd(
  job: JobDetail,
  locale: string,
  governorateName?: string | null,
) {
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
    description: toDescriptionHtml(description),
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
        // The governorate, not the district. These were both the district,
        // which told Google that New Cairo is a region of Egypt — the level it
        // matches "jobs near me" against, so getting it wrong costs exactly
        // the traffic this markup exists to earn.
        addressRegion: governorateName || districtName,
        addressCountry: 'EG',
      },
    },
    // Google reads this as a number; free text here is discarded, which is
    // where the requirements prose used to go.
    experienceRequirements: {
      '@type': 'OccupationalExperienceRequirements',
      monthsOfExperience: MONTHS_OF_EXPERIENCE[job.experience_band],
    },
    ...(job.seats > 1 ? { totalJobOpenings: job.seats } : {}),
    ...(requirements ? { qualifications: requirements } : {}),
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
