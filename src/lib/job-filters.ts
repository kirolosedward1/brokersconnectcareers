/**
 * The job board's filter model: what a filtered board is, how it is read from
 * a URL, and how it is written back into one.
 *
 * Out of `queries/jobs.ts` because that file pulls in the server client and
 * `server-only`, and three other readers need exactly this model and nothing
 * else: the saved-search canonicaliser, the job-alerts cron that replays a
 * saved query, and the mobile app, which sends the same query string to the
 * same board. One parser means the app cannot drift from the website on what
 * `?pay=10000` or `?district=a,b` means.
 *
 * Pure: constants and types from the taxonomy, and one slug check.
 */

import {
  COMMISSION_TYPES,
  COMPANY_TYPES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
  MIN_SALARY_STEPS,
  POSTED_WITHIN_DAYS,
} from '@/lib/taxonomy';
import type {
  CommissionType,
  CompanyType,
  EmploymentType,
  ExperienceBand,
  JobTrack,
  LeadsSource,
} from '@/lib/supabase/database.types';
import { companySlugOrNull } from '@/lib/search/company-slug';

export const JOBS_PER_PAGE = 20;

export type JobSort = 'newest' | 'salary' | 'seats';

export type JobFilters = {
  q: string;
  tracks: JobTrack[];
  leadsSources: LeadsSource[];
  experienceBands: ExperienceBand[];
  employmentTypes: EmploymentType[];
  districtSlugs: string[];
  governorateSlug: string | null;
  hasBasicSalary: boolean | null;
  /** EGP a month the basic reaches at least; one of MIN_SALARY_STEPS. */
  minSalary: number | null;
  /** How the commission is structured. Several values mean "either". */
  commissionTypes: CommissionType[];
  /** Published within this many days; one of POSTED_WITHIN_DAYS. */
  postedWithin: number | null;
  /**
   * One company's listings, by slug.
   *
   * Here rather than in a table of its own because "follow this brokerage" is
   * the same question as "show me this brokerage's roles", asked weekly. A
   * follow is a saved search carrying this filter with alerts on, so the
   * digest that already exists delivers it — no second table, no second mail,
   * and no second copy of the filter model to drift out of step.
   */
  companySlug: string | null;
  /**
   * Brokerages or developers — what the company said it is, see migration 67.
   * Several values mean "either", like every other multi-select here.
   */
  companyTypes: CompanyType[];
  sort: JobSort;
  page: number;
};

export const EMPTY_FILTERS: JobFilters = {
  q: '',
  tracks: [],
  leadsSources: [],
  experienceBands: [],
  employmentTypes: [],
  districtSlugs: [],
  governorateSlug: null,
  hasBasicSalary: null,
  minSalary: null,
  commissionTypes: [],
  postedWithin: null,
  companySlug: null,
  companyTypes: [],
  sort: 'newest',
  page: 1,
};

export type SearchParams = Record<string, string | string[] | undefined>;

function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(',')).filter(Boolean);
}

function only<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

/** A number from the URL, kept only if it is one of the offered steps. */
function step(value: string | string[] | undefined, allowed: readonly number[]): number | null {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return allowed.includes(n) ? n : null;
}

/**
 * Filter state lives in the URL and nowhere else, so a filtered board is
 * shareable, bookmarkable, and survives a reload or a language switch.
 */
export function parseJobFilters(searchParams: SearchParams): JobFilters {
  const salary = typeof searchParams.salary === 'string' ? searchParams.salary : null;
  const sort = typeof searchParams.sort === 'string' ? searchParams.sort : 'newest';
  const page = Number.parseInt(String(searchParams.page ?? '1'), 10);

  return {
    q: (typeof searchParams.q === 'string' ? searchParams.q : '').trim().slice(0, 120),
    tracks: only(many(searchParams.track), JOB_TRACKS),
    leadsSources: only(many(searchParams.leads), LEADS_SOURCES),
    experienceBands: only(many(searchParams.exp), EXPERIENCE_BANDS),
    employmentTypes: only(many(searchParams.type), EMPLOYMENT_TYPES),
    districtSlugs: many(searchParams.district).slice(0, 12),
    governorateSlug: typeof searchParams.gov === 'string' ? searchParams.gov : null,
    hasBasicSalary: salary === 'yes' ? true : salary === 'no' ? false : null,
    minSalary: step(searchParams.pay, MIN_SALARY_STEPS),
    commissionTypes: only(many(searchParams.comm), COMMISSION_TYPES),
    postedWithin: step(searchParams.posted, POSTED_WITHIN_DAYS),
    companySlug: companySlugOrNull(searchParams.company),
    companyTypes: only(many(searchParams.ctype), COMPANY_TYPES),
    sort: sort === 'salary' || sort === 'seats' ? sort : 'newest',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

/** Inverse of parseJobFilters. Omits defaults so URLs stay short. */
export function serializeJobFilters(filters: JobFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  for (const track of filters.tracks) params.append('track', track);
  for (const leads of filters.leadsSources) params.append('leads', leads);
  for (const band of filters.experienceBands) params.append('exp', band);
  for (const type of filters.employmentTypes) params.append('type', type);
  for (const district of filters.districtSlugs) params.append('district', district);
  if (filters.governorateSlug) params.set('gov', filters.governorateSlug);
  if (filters.hasBasicSalary === true) params.set('salary', 'yes');
  if (filters.hasBasicSalary === false) params.set('salary', 'no');
  if (filters.minSalary) params.set('pay', String(filters.minSalary));
  for (const type of filters.commissionTypes) params.append('comm', type);
  if (filters.postedWithin) params.set('posted', String(filters.postedWithin));
  if (filters.companySlug) params.set('company', filters.companySlug);
  for (const type of filters.companyTypes) params.append('ctype', type);
  if (filters.sort !== 'newest') params.set('sort', filters.sort);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

export function countActiveFilters(filters: JobFilters): number {
  return (
    (filters.q ? 1 : 0) +
    filters.tracks.length +
    filters.leadsSources.length +
    filters.experienceBands.length +
    filters.employmentTypes.length +
    filters.districtSlugs.length +
    (filters.governorateSlug ? 1 : 0) +
    (filters.hasBasicSalary === null ? 0 : 1) +
    (filters.minSalary ? 1 : 0) +
    filters.commissionTypes.length +
    (filters.postedWithin ? 1 : 0) +
    (filters.companySlug ? 1 : 0) +
    filters.companyTypes.length
  );
}
