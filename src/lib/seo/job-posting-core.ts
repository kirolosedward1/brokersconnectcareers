/**
 * The JobPosting builder, with nothing in it but the mapping.
 *
 * No path aliases, no environment, no locale helpers — the caller resolves the
 * language and the absolute URLs, and this turns one listing's stored fields
 * into schema.org. That keeps it runnable under `node --experimental-strip-types`,
 * which is how scripts/job-posting.test.mjs checks it against Google's rules
 * without a database or a server.
 *
 * Every value here comes from a column. Where the column is empty the property
 * is left out rather than filled with something plausible: a salary nobody
 * stated, a region guessed from a district, an expiry the listing does not
 * have. Google treats markup that disagrees with the page as spam, and the
 * one thing this board promises is that a listing says what it pays.
 */

export type EmploymentTypeValue = 'full_time' | 'part_time' | 'freelance_commission_only';
export type ExperienceBandValue = 'fresh_0_1' | 'junior_1_3' | 'mid_3_5' | 'senior_5_plus';

export type JobPostingInput = {
  id: string;
  /** Absolute URL of the listing's own page. */
  url: string;
  title: string;
  /** As stored: plain text, paragraphs separated by blank lines. */
  description: string;
  requirements?: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  employmentType: EmploymentTypeValue;
  experienceBand: ExperienceBandValue;
  seats: number;
  /** EGP per month. Null on both means commission only. */
  salaryMin: number | null;
  salaryMax: number | null;
  company: {
    name: string;
    website?: string | null;
    logoUrl?: string | null;
  };
  location: {
    /** The district. */
    locality: string;
    /** The governorate — null when the taxonomy could not name it. */
    region: string | null;
  };
};

const EMPLOYMENT_TYPE: Record<EmploymentTypeValue, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  // Commission-only work is contractor work in schema.org's vocabulary; there
  // is no closer term, and CONTRACTOR is what aggregators expect.
  freelance_commission_only: 'CONTRACTOR',
};

/**
 * The floor of each band, in months — the requirement, not the expectation.
 *
 * A fresh-graduate band has no floor, and Google's documented way to say so is
 * the literal "no requirements", not a zero: a zero reads as a requirement of
 * nothing in particular and is what a missing value looks like.
 */
const MONTHS_OF_EXPERIENCE: Record<ExperienceBandValue, number | null> = {
  fresh_0_1: null,
  junior_1_3: 12,
  mid_3_5: 36,
  senior_5_plus: 60,
};

export function plainText(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Blank lines are paragraphs and single line breaks stay line breaks — the
 * page renders both (`whitespace-pre-line`), and a requirements list typed one
 * item per line should not reach Google as one run-on sentence.
 */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => escapeHtml(plainText(line)))
        .filter(Boolean)
        .join('<br>'),
    )
    .filter(Boolean);
}

/**
 * Google asks for the full description in HTML and renders it in the job
 * panel. Stored text keeps one piece of structure — blank lines between
 * paragraphs — and everything else is escaped, because the text is the
 * employer's and goes into a document, not a page.
 *
 * The requirements are appended under their own heading because the page
 * shows them under the description, and the guideline is that the marked-up
 * description is the whole of what the page describes.
 */
export function descriptionHtml(
  description: string,
  requirements?: string | null,
  requirementsHeading = 'Requirements',
): string {
  const body = paragraphs(description).map((p) => `<p>${p}</p>`).join('');
  // No description is no description, whatever else the listing carries —
  // requirements under a heading are not a job description on their own.
  if (!body) return '';
  const reqs = requirements ? paragraphs(requirements) : [];
  return reqs.length
    ? `${body}<p><strong>${escapeHtml(requirementsHeading)}</strong></p>${reqs.map((p) => `<p>${p}</p>`).join('')}`
    : body;
}

function iso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function httpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Google's required properties, in the order its report lists them. */
export const REQUIRED = ['datePosted', 'description', 'hiringOrganization', 'jobLocation', 'title'] as const;

/**
 * What is wrong with a payload, as Google's Rich Results Test would say it.
 * Empty means valid. Used by the builder to refuse to emit a broken payload
 * and by the test suite to check the rules directly.
 */
export function jobPostingProblems(data: Record<string, unknown> | null, now = new Date()): string[] {
  if (!data) return ['no payload'];
  const problems: string[] = [];

  for (const key of REQUIRED) {
    const value = data[key];
    if (value == null || value === '') problems.push(`missing ${key}`);
  }

  const org = data.hiringOrganization as { name?: string } | undefined;
  if (org && !org.name) problems.push('hiringOrganization.name is empty');

  const place = data.jobLocation as { address?: { addressCountry?: string; addressLocality?: string } } | undefined;
  if (place && !place.address?.addressCountry) problems.push('jobLocation.address.addressCountry is missing');
  if (place && !place.address?.addressLocality) problems.push('jobLocation.address.addressLocality is missing');

  const posted = typeof data.datePosted === 'string' ? new Date(data.datePosted) : null;
  const through = typeof data.validThrough === 'string' ? new Date(data.validThrough) : null;
  if (through && through <= now) problems.push('validThrough is in the past');
  if (posted && through && through <= posted) problems.push('validThrough precedes datePosted');
  if (posted && posted.getTime() > now.getTime() + 60_000) problems.push('datePosted is in the future');

  const salary = data.baseSalary as
    | {
        currency?: string;
        value?: { value?: number; minValue?: number; maxValue?: number; unitText?: string };
      }
    | undefined;
  if (salary) {
    if (!salary.currency) problems.push('baseSalary.currency is missing');
    if (!salary.value?.unitText) problems.push('baseSalary.value.unitText is missing');
    const minValue = salary.value?.value ?? salary.value?.minValue;
    const maxValue = salary.value?.value ?? salary.value?.maxValue;
    if (minValue == null && maxValue == null) problems.push('baseSalary has no amount');
    if (minValue != null && maxValue != null && maxValue < minValue) problems.push('baseSalary range is inverted');
    if ((minValue ?? 1) <= 0 && (maxValue ?? 1) <= 0) problems.push('baseSalary is zero');
  }

  return problems;
}

/**
 * schema.org JobPosting for Google's job experience, or null when the listing
 * cannot be described honestly — no publish date, no description, an expiry
 * already behind it. The caller decides whether the listing is open; this
 * refuses anyway if the dates say otherwise, so a stale page can never carry
 * live markup even if the caller's check drifts.
 */
export function buildJobPosting(
  input: JobPostingInput,
  options: { requirementsHeading?: string; now?: Date } = {},
): Record<string, unknown> | null {
  const description = descriptionHtml(input.description, input.requirements, options.requirementsHeading);
  const months = MONTHS_OF_EXPERIENCE[input.experienceBand];
  const website = httpUrl(input.company.website);
  const logo = httpUrl(input.company.logoUrl);

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: plainText(input.title),
    description,
    identifier: {
      '@type': 'PropertyValue',
      name: input.company.name,
      value: input.id,
    },
    datePosted: iso(input.publishedAt),
    ...(iso(input.expiresAt) ? { validThrough: iso(input.expiresAt) } : {}),
    employmentType: EMPLOYMENT_TYPE[input.employmentType],
    industry: 'Real Estate',
    /*
      False, and said out loud.

      Applying here needs an account, a finished onboarding and then the form —
      three sets of details for somebody arriving from Google without one.
      Google's definition of direct apply is providing your information once,
      on the page you land on. Claiming it would be the kind of mismatch the
      job guidelines single out, so the markup says what the flow is.
    */
    directApply: false,
    url: input.url,
    hiringOrganization: {
      '@type': 'Organization',
      name: input.company.name,
      // The company's own site, or nothing. Our page about the company is not
      // the organisation's identity on the web.
      ...(website ? { sameAs: website } : {}),
      ...(logo ? { logo } : {}),
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: input.location.locality,
        // The governorate — the level Google matches "jobs near me" against.
        // Omitted rather than filled with the district when unknown.
        ...(input.location.region ? { addressRegion: input.location.region } : {}),
        addressCountry: 'EG',
      },
    },
    experienceRequirements:
      months == null
        ? 'no requirements'
        : { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: months },
    ...(input.seats > 1 ? { totalJobOpenings: input.seats } : {}),
  };

  // Only honest when there is a basic salary. Commission-only roles omit it
  // rather than reporting zero, and a zero on either end is not a salary.
  const min = input.salaryMin != null && input.salaryMin > 0 ? input.salaryMin : null;
  const max = input.salaryMax != null && input.salaryMax > 0 ? input.salaryMax : null;
  if (min != null || max != null) {
    data.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'EGP',
      value: {
        '@type': 'QuantitativeValue',
        ...(min != null && max != null && min === max
          ? { value: min }
          : {
              ...(min != null ? { minValue: min } : {}),
              ...(max != null ? { maxValue: max } : {}),
            }),
        unitText: 'MONTH',
      },
    };
  }

  return jobPostingProblems(data, options.now).length ? null : data;
}
