import type {
  AgentAvailability,
  Benefit,
  CommissionType,
  CompanyType,
  EmploymentType,
  ExperienceBand,
  JobTrack,
  LeadsSource,
} from '@/lib/supabase/database.types';

export const JOB_TRACKS = [
  'primary',
  'resale',
  'rental',
  'commercial',
  'property_management',
  'back_office',
] as const satisfies readonly JobTrack[];

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'freelance_commission_only',
] as const satisfies readonly EmploymentType[];

export const EXPERIENCE_BANDS = [
  'fresh_0_1',
  'junior_1_3',
  'mid_3_5',
  'senior_5_plus',
] as const satisfies readonly ExperienceBand[];

export const LEADS_SOURCES = ['company_provided', 'self_generated', 'hybrid'] as const satisfies readonly LeadsSource[];

export const COMMISSION_TYPES = ['percentage', 'split', 'undisclosed', 'none'] as const satisfies readonly CommissionType[];

/**
 * "Posted within" on the board, in days. The three windows a job seeker
 * actually checks: since yesterday, this week, this listing cycle — a listing
 * runs thirty days, so a longer window is the same as no window.
 */
export const POSTED_WITHIN_DAYS = [1, 7, 30] as const;

/**
 * "Basic salary of at least" on the board, EGP a month. Steps rather than a
 * free number, so each one is a URL worth sharing and a saved search two
 * people arrive at the same way.
 */
export const MIN_SALARY_STEPS = [5000, 8000, 10000, 15000, 20000] as const;

export const BENEFITS = [
  'social_insurance',
  'medical',
  'transport',
  'training',
  'mobile_allowance',
] as const satisfies readonly Benefit[];

export const AVAILABILITIES = [
  'open_to_offers',
  'actively_searching',
  'employed_not_looking',
] as const satisfies readonly AgentAvailability[];

/**
 * URL form of each track. The enum values carry underscores, which do not
 * belong in a public URL, and `primary` on its own is too vague to rank for.
 */
const TRACK_SLUGS: Record<JobTrack, string> = {
  primary: 'primary-sales',
  resale: 'resale',
  rental: 'rentals',
  commercial: 'commercial',
  property_management: 'property-management',
  back_office: 'back-office',
};

const SLUG_TO_TRACK = Object.fromEntries(
  Object.entries(TRACK_SLUGS).map(([track, slug]) => [slug, track as JobTrack]),
) as Record<string, JobTrack>;

export function trackSlug(track: JobTrack): string {
  return TRACK_SLUGS[track];
}

export function trackFromSlug(slug: string): JobTrack | null {
  return SLUG_TO_TRACK[slug] ?? null;
}

/** Longest first, so `primary-sales` is tried before any shorter prefix. */
const TRACK_SLUGS_BY_LENGTH = Object.values(TRACK_SLUGS).sort((a, b) => b.length - a.length);

/**
 * Splits a programmatic landing slug such as `primary-sales-new-cairo` into its
 * track and district halves. Returns null when the slug is not one of ours —
 * which is how /jobs/[slug] knows to treat it as a job slug instead.
 */
export function parseLandingSlug(slug: string): { track: JobTrack; districtSlug: string } | null {
  for (const candidate of TRACK_SLUGS_BY_LENGTH) {
    if (slug.startsWith(`${candidate}-`)) {
      const districtSlug = slug.slice(candidate.length + 1);
      if (districtSlug) {
        return { track: SLUG_TO_TRACK[candidate], districtSlug };
      }
    }
  }
  return null;
}

export function buildLandingSlug(track: JobTrack, districtSlug: string): string {
  return `${trackSlug(track)}-${districtSlug}`;
}

/**
 * What kind of employer a company is — stated by the company, never inferred
 * from its name. See migration 67.
 */
export const COMPANY_TYPES = ['brokerage', 'developer'] as const satisfies readonly CompanyType[];

export const HEADCOUNT_BANDS = ['1_10', '11_50', '51_200', '201_500', '500_plus'] as const;

/**
 * Why somebody reports a listing, most serious first — the order a candidate
 * who has just been asked for money reads them in, and the order severity is
 * ranked in the queue (migration 208). `duplicate` and `discriminatory` are no
 * longer offered: "spam or duplicate" and "offensive or discriminatory" cover
 * them in fewer choices, and the database still accepts both for the reports
 * already filed with them.
 */
export const REPORT_REASONS = [
  'scam',
  'fake_listing',
  'impersonation',
  'misleading_pay',
  'inappropriate',
  'spam',
  'other',
] as const;

/**
 * Why somebody reports a company rather than a listing (migration 206).
 * `other` last, as on listings, so the specific reasons are read first.
 */
export const COMPANY_REPORT_REASONS = [
  'suspicious_company',
  'scam',
  'impersonation',
  'harassment',
  'inappropriate',
  'other',
] as const;

/** And a consultant's profile, where the usual problem is who it claims to be. */
export const AGENT_REPORT_REASONS = [
  'impersonation',
  'inappropriate',
  'harassment',
  'scam',
  'spam',
  'other',
] as const;

/**
 * Seat-tiered packs. Prices are the starting hypothesis from the spec and are
 * charged only when BILLING_ENABLED is true.
 */
export const POST_PACKS = [
  { key: 'single', seats: 3, days: 30, priceEgp: 1000, credits: 1 },
  { key: 'bulk', seats: 15, days: 30, priceEgp: 3000, credits: 1 },
  { key: 'mass_hiring', seats: null, days: 30, priceEgp: 6000, credits: 1 },
  { key: 'featured_addon', seats: null, days: 14, priceEgp: 750, credits: 0 },
] as const;
