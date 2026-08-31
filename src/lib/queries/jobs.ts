import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import { getDistricts, getGovernorates } from './taxonomy';
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
} from '@/lib/taxonomy';
import type {
  CompanyRow,
  DistrictRow,
  EmploymentType,
  ExperienceBand,
  JobRow,
  JobTrack,
  LeadsSource,
} from '@/lib/supabase/database.types';

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
    (filters.hasBasicSalary === null ? 0 : 1)
  );
}

export type JobListItem = JobRow & {
  company: Pick<
    CompanyRow,
    'id' | 'name_ar' | 'name_en' | 'slug' | 'logo_url' | 'verification_status'
  >;
  district: DistrictRow;
};

const LIST_SELECT = `
  *,
  company:companies!inner (id, name_ar, name_en, slug, logo_url, verification_status),
  district:districts!inner (id, governorate_id, name_ar, name_en, slug)
`;

export async function queryJobs(filters: JobFilters): Promise<{
  jobs: JobListItem[];
  total: number;
  pageCount: number;
}> {
  const supabase = await createClient();
  const districts = await getDistricts();

  // Resolve district and governorate slugs to ids up front — the taxonomy is
  // cached, so this costs nothing and keeps the query to a single round trip.
  let districtIds: number[] | null = null;

  if (filters.districtSlugs.length) {
    districtIds = districts
      .filter((d) => filters.districtSlugs.includes(d.slug))
      .map((d) => d.id);
  }

  if (filters.governorateSlug) {
    const governorates = await getGovernorates();
    const governorate = governorates.find((g) => g.slug === filters.governorateSlug);
    const inGovernorate = new Set(
      districts.filter((d) => d.governorate_id === governorate?.id).map((d) => d.id),
    );
    districtIds = districtIds
      ? districtIds.filter((id) => inGovernorate.has(id))
      : [...inGovernorate];
  }

  // An empty id set after intersection means nothing can match.
  if (districtIds && districtIds.length === 0) {
    return { jobs: [], total: 0, pageCount: 0 };
  }

  let query = supabase
    .from('jobs')
    .select(LIST_SELECT, { count: 'exact' })
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());

  if (filters.q) {
    query = query.textSearch('search_vector', filters.q, { type: 'websearch', config: 'simple' });
  }
  if (filters.tracks.length) query = query.in('track', filters.tracks);
  if (filters.leadsSources.length) query = query.in('leads_source', filters.leadsSources);
  if (filters.experienceBands.length) query = query.in('experience_band', filters.experienceBands);
  if (filters.employmentTypes.length) query = query.in('employment_type', filters.employmentTypes);
  if (districtIds) query = query.in('district_id', districtIds);

  if (filters.hasBasicSalary === true) query = query.not('basic_salary_min', 'is', null);
  if (filters.hasBasicSalary === false) query = query.is('basic_salary_min', null);

  // Featured listings pin to the top of every sort; the paid placement is
  // worthless if a sort change buries it.
  query = query.order('is_featured', { ascending: false });

  if (filters.sort === 'salary') {
    query = query.order('basic_salary_max', { ascending: false, nullsFirst: false });
  } else if (filters.sort === 'seats') {
    query = query.order('seats', { ascending: false });
  }
  query = query.order('published_at', { ascending: false });

  const from = (filters.page - 1) * JOBS_PER_PAGE;
  const { data, error, count } = await query.range(from, from + JOBS_PER_PAGE - 1);
  if (error) raise(error, 'searching jobs');

  const total = count ?? 0;
  return {
    jobs: (data ?? []) as unknown as JobListItem[],
    total,
    pageCount: Math.max(1, Math.ceil(total / JOBS_PER_PAGE)),
  };
}

export type JobDetail = JobRow & {
  company: CompanyRow & { district: DistrictRow | null };
  district: DistrictRow;
  job_developers: { developer: { id: number; name_ar: string; name_en: string; slug: string } }[];
};

export async function getJobBySlug(slug: string): Promise<JobDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('jobs')
    .select(
      `
      *,
      company:companies!inner (*, district:districts (id, governorate_id, name_ar, name_en, slug)),
      district:districts!inner (id, governorate_id, name_ar, name_en, slug),
      job_developers (developer:developers (id, name_ar, name_en, slug))
    `,
    )
    .eq('slug', slug)
    .maybeSingle();

  if (error) raise(error, 'loading a job');
  return (data as unknown as JobDetail) ?? null;
}

/** Same track or same district, excluding the job being viewed. */
export async function getSimilarJobs(job: JobRow, limit = 4): Promise<JobListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('jobs')
    .select(LIST_SELECT)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .neq('id', job.id)
    .or(`track.eq.${job.track},district_id.eq.${job.district_id}`)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) raise(error, 'loading similar jobs');
  return (data ?? []) as unknown as JobListItem[];
}
