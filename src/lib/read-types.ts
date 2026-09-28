/**
 * The shapes the website's read queries return, as types and nothing else.
 *
 * They lived beside the queries, which pull in the server client, so the
 * mobile app — which receives exactly these shapes from /api/mobile/v1 — could
 * not name them. The query modules import them from here and re-export them.
 */
import type { CompanyRow, CompanyType, DistrictRow, JobTrack } from '@/lib/supabase/database.types';

/** A company in the directory list, with its district and its live-listing count. */
export type CompanyListItem = CompanyRow & {
  district: DistrictRow | null;
  open_roles: { count: number }[];
};

/** A company's own page. */
export type CompanyProfile = CompanyRow & { district: DistrictRow | null };

/** How many live listings sit behind each way of browsing the board. */
export type BrowseCounts = {
  /** Every live listing, which is also what an unfiltered board reports. */
  total: number;
  tracks: { track: JobTrack; count: number }[];
  districts: { districtId: number; count: number }[];
  /**
   * Null when the database does not record a company's type — before the
   * migration that adds it has been applied. The module then draws two groups
   * instead of three, rather than failing or guessing a type from a name.
   */
  companyTypes: { type: CompanyType; count: number }[] | null;
  /**
   * Live listings per track x district pair, most first. These are exactly
   * the landing pages that have something on them — what the sitemap
   * advertises and what the internal links between landings prefer.
   */
  pairs: { track: JobTrack; districtId: number; count: number }[];
};

/** What a track-in-a-district landing page leads with. */
export type LandingFacts = {
  listings: number;
  companies: number;
  withBasicSalary: number;
  salaryFloor: number | null;
  salaryCeiling: number | null;
};
