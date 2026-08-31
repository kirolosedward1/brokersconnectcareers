import type {
  AgentAvailability,
  Benefit,
  CommissionType,
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

export const HEADCOUNT_BANDS = ['1_10', '11_50', '51_200', '201_500', '500_plus'] as const;

export const REPORT_REASONS = [
  'fake_listing',
  'misleading_pay',
  'duplicate',
  'spam',
  'discriminatory',
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
