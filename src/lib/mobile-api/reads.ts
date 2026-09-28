import type { JobDetail, JobListItem } from '@/lib/job-list';
import type { BrowseCounts, CompanyListItem, LandingFacts } from '@/lib/read-types';
import type {
  AgentCardRow,
  CompanyRow,
  DistrictRow,
  JobTrack,
  SalaryReferenceRow,
} from '@/lib/supabase/database.types';

/**
 * What each GET under /api/mobile/v1 answers — the read half of contract.ts.
 *
 * The endpoints declare they satisfy these, so the website's typecheck fails
 * before the app ever receives a shape it was not promised. Types only.
 */

/** GET /config */
export type MobileConfig = {
  minAppVersion: string;
  turnstileSiteKey: string | null;
  providers: { google: boolean; apple: boolean };
  englishEnabled: boolean;
  billingEnabled: boolean;
};

/** GET /jobs */
export type JobBoardResponse = {
  jobs: JobListItem[];
  total: number;
  pageCount: number;
  /** The page actually served, which is not always the one asked for. */
  page: number;
  pageSize: number;
  /** On an empty board: which one filter to drop (activeFilterList keys) and what that brings back. */
  relaxations: { key: string; count: number }[];
  /** The pinned company, when `?company=` narrows the board to one. */
  company: Pick<
    CompanyRow,
    'id' | 'slug' | 'name_ar' | 'name_en' | 'logo_url' | 'verification_status'
  > | null;
};

/** GET /jobs/<slug> — `reference` is what listings like it pay, null below five of them. */
export type JobDetailResponse = {
  job: JobDetail;
  similar: JobListItem[];
  reference: SalaryReferenceRow | null;
};

/** GET /companies */
export type CompanyListResponse = {
  companies: CompanyListItem[];
  total: number;
  pageCount: number;
  page: number;
};

/** GET /companies/<slug> — the company's public columns only. */
export type CompanyPageResponse = {
  company: Pick<
    CompanyRow,
    | 'id'
    | 'slug'
    | 'name_ar'
    | 'name_en'
    | 'logo_url'
    | 'about_ar'
    | 'about_en'
    | 'website'
    | 'headcount_band'
    | 'company_type'
    | 'verification_status'
    | 'verified_at'
  > & { district: DistrictRow | null };
  jobs: JobListItem[];
  total: number;
};

/** GET /agents */
export type AgentDirectoryResponse = {
  agents: AgentCardRow[];
  total: number;
  pageCount: number;
  page: number;
};

/** GET /browse */
export type BrowseResponse = BrowseCounts;

/** GET /landing/<slug> */
export type LandingResponse = {
  track: JobTrack;
  district: Pick<DistrictRow, 'id' | 'slug' | 'name_ar' | 'name_en'>;
  facts: LandingFacts;
};
