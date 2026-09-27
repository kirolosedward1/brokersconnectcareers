import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import { getDistricts, getGovernorates, getSearchPhrases } from './taxonomy';
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
  CompanyRow,
  CompanyType,
  DistrictRow,
  EmploymentType,
  ExperienceBand,
  JobRow,
  JobTrack,
  LeadsSource,
  SalaryReferenceRow,
} from '@/lib/supabase/database.types';
import { buildJobQuery, searchText } from '@/lib/search/arabic';
import { companySlugOrNull } from '@/lib/search/company-slug';
import { logFailure } from '@/lib/observe';

export const JOBS_PER_PAGE = 20;

export type JobSort = 'newest' | 'salary' | 'seats';

/** Anything shaped like the Supabase client's `.from()` entry point. */
type SupabaseLikeClient = Awaited<ReturnType<typeof createClient>>;

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

/**
 * The same, joined to the listing's search document — a filter, not data.
 *
 * An empty embed returns nothing, and `!inner` narrows the listings (and the
 * exact count) to those whose document matches. The document's own policy
 * inherits the listing's, so this cannot reach a draft.
 */
const SEARCH_SELECT = `${LIST_SELECT}, search:job_search_documents!inner ()`;

/**
 * Everything needed to run the board query that is not the filters: which
 * districts they name, and how the keyword reads as a query.
 */
type Resolved = {
  districtIds: number[] | null;
  /** to_tsquery syntax, or null for no keyword search. */
  tsquery: string | null;
};

async function resolveFilters(filters: JobFilters): Promise<Resolved | null> {
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
  if (districtIds && districtIds.length === 0) return null;

  // A keyword with nothing searchable in it — punctuation, a lone quote — is
  // no keyword, rather than a query that matches nothing.
  const tsquery = filters.q ? buildJobQuery(filters.q, await getSearchPhrases()) : null;

  return { districtIds, tsquery };
}

/**
 * The board query, with the filters applied and nothing else.
 *
 * `legacy` searches jobs.search_vector instead of the search document. That
 * column is what the board searched before migration 68, and it is kept for
 * exactly one case: this code reaching a database the migration has not. The
 * embed then fails with PGRST200 and the caller asks again this way.
 */
function applyFilters(
  supabase: SupabaseLikeClient,
  filters: JobFilters,
  resolved: Resolved,
  { head = false, legacy = false }: { head?: boolean; legacy?: boolean } = {},
) {
  const searching = Boolean(resolved.tsquery) && !legacy;

  let query = supabase
    .from('jobs')
    .select(searching ? SEARCH_SELECT : LIST_SELECT, { count: 'exact', head })
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());

  if (searching && resolved.tsquery) {
    query = query.textSearch('search.document', resolved.tsquery, { config: 'simple' });
  } else if (legacy && filters.q) {
    // Folded the same way the index was. Without this the query keeps its
    // harakat, its hamza and its ال while the index has none of them, and an
    // exact match on the screen is a miss in the database.
    query = query.textSearch('search_vector', searchText(filters.q), {
      type: 'websearch',
      config: 'simple',
    });
  }
  if (filters.tracks.length) query = query.in('track', filters.tracks);
  if (filters.leadsSources.length) query = query.in('leads_source', filters.leadsSources);
  if (filters.experienceBands.length) query = query.in('experience_band', filters.experienceBands);
  if (filters.employmentTypes.length) query = query.in('employment_type', filters.employmentTypes);
  if (filters.commissionTypes.length) query = query.in('commission_type', filters.commissionTypes);
  if (resolved.districtIds) query = query.in('district_id', resolved.districtIds);

  if (filters.hasBasicSalary === true) query = query.not('basic_salary_min', 'is', null);
  if (filters.hasBasicSalary === false) query = query.is('basic_salary_min', null);

  /*
    "At least" means the range reaches it: a listing paying 8,000–12,000 is
    one a person asking for 10,000 wants to see. A listing that gave only a
    minimum is judged on that. The value is one of MIN_SALARY_STEPS — the
    parser drops anything else — so interpolating it here is interpolating a
    constant, not the URL.
  */
  if (filters.minSalary) {
    const floor = filters.minSalary;
    query = query.or(
      `basic_salary_max.gte.${floor},and(basic_salary_max.is.null,basic_salary_min.gte.${floor})`,
    );
  }

  if (filters.postedWithin) {
    const since = new Date(Date.now() - filters.postedWithin * 24 * 60 * 60 * 1000);
    query = query.gte('published_at', since.toISOString());
  }

  /*
    Through the embedded company rather than a resolved id.

    `companies!inner` is already in the select, so this narrows the top-level
    rows and the exact count along with them — one round trip instead of a slug
    lookup followed by the real query. The value is slug-shaped by the parser
    above, and `.eq` encodes its operand rather than splicing it into a filter
    expression, so neither half of this is trusting the URL.
  */
  if (filters.companySlug) query = query.eq('company.slug', filters.companySlug);

  // Same embedded-company route as the slug above. An unclassified company has
  // a null here and so matches neither value — absent from a by-type view
  // rather than filed under a guess.
  if (filters.companyTypes.length) {
    query = query.in('company.company_type', filters.companyTypes);
  }

  return query;
}

/** PostgREST could not find the search document's relationship: pre-68. */
const isMissingSearchDocuments = (error: { code?: string } | null) =>
  error?.code === 'PGRST200' || error?.code === '42P01';

/**
 * `client` lets a caller with no request context — the weekly alert job — run
 * exactly this query rather than a second copy of it. Passing the public
 * client there is deliberate: an alert email must never contain a listing the
 * recipient could not see for themselves.
 */
export const queryJobs = cache(async function queryJobs(
  filters: JobFilters,
  client?: SupabaseLikeClient,
): Promise<{
  jobs: JobListItem[];
  total: number;
  pageCount: number;
  /** The page actually returned, which is not always the one asked for. */
  page: number;
}> {
  const supabase = client ?? (await createClient());
  const resolved = await resolveFilters(filters);

  if (!resolved) return { jobs: [], total: 0, pageCount: 0, page: 1 };

  let legacy = false;

  /*
    Built fresh each time rather than held in one variable.

    PostgREST refuses an offset past the end of the result set outright —
    PGRST103, "Requested range not satisfiable" — so `?page=400` on a board of
    fifteen listings did not return an empty page, it threw, and the board
    answered with a 500 carrying the database's own message. The recovery below
    has to issue a second query with a different range, and a builder that has
    already been awaited is not something to lean on for that.
  */
  const build = () => {
    let query = applyFilters(supabase, filters, resolved, { legacy });

    // Featured listings pin to the top of every sort; the paid placement is
    // worthless if a sort change buries it.
    query = query.order('is_featured', { ascending: false });

    if (filters.sort === 'salary') {
      query = query.order('basic_salary_max', { ascending: false, nullsFirst: false });
    } else if (filters.sort === 'seats') {
      query = query.order('seats', { ascending: false });
    }
    query = query.order('published_at', { ascending: false });
    /*
      The last key, so the order is total.

      Every key above it can tie — `seats` on almost every listing, salary
      wherever two companies pay the same, and `published_at` the moment a
      moderator approves two in the same second. An order with ties is not an
      order: Postgres is free to return the tied rows differently between the
      query for page one and the query for page two, which shows one listing
      twice and hides another entirely. It costs nothing and it cannot tie.
    */
    query = query.order('id', { ascending: false });

    return query;
  };

  const pageOf = (page: number) => {
    const from = (page - 1) * JOBS_PER_PAGE;
    return build().range(from, from + JOBS_PER_PAGE - 1);
  };

  let { data, error, count } = await pageOf(filters.page);

  if (resolved.tsquery && isMissingSearchDocuments(error)) {
    logFailure('jobs', 'search documents missing; searching the legacy column', {
      code: error?.code,
    });
    legacy = true;
    ({ data, error, count } = await pageOf(filters.page));
  }

  /*
    A page past the end is answered with the end, not with a 500 and not with
    "no listings match".

    Two different failures used to live here. A page just past the last one
    came back empty and the board rendered its no-results panel — "nothing
    matches your filters", offered on a search that matches fifteen — under a
    footer reading "page 99 of 1". And a page far enough past it did not come
    back at all: PostgREST answers an unsatisfiable range with PGRST103, which
    `raise` turned into a 500 carrying the database's own message about offsets
    and row counts.

    Both are the same question — how many pages are there — which is only
    answerable after a query. So: ask for the first page, which always exists,
    and go to the last one from there.
  */
  if (error?.code === 'PGRST103' || (!error && count != null && filters.page > 1 && !data?.length)) {
    const { count: total, error: countError } = await pageOf(1);
    if (countError) raise(countError, 'searching jobs');

    const pageCount = Math.max(1, Math.ceil((total ?? 0) / JOBS_PER_PAGE));
    const { data: lastPage, error: lastError } = await pageOf(pageCount);
    if (lastError) raise(lastError, 'searching jobs');

    return {
      jobs: (lastPage ?? []) as unknown as JobListItem[],
      total: total ?? 0,
      pageCount,
      page: pageCount,
    };
  }

  /*
    A by-type search against a database that does not record types yet.

    42703 is "no such column", and the only column this query names that a
    deployed database may lack is companies.company_type — code reaches
    production before migration 67 as often as after. The honest answer to
    "show me developers' listings" when no company has said it is a developer
    is that there are none, which is also exactly what the query returns the
    moment the column exists and is still empty. A 500 would be the wrong
    answer on both sides of the migration.
  */
  if (error?.code === '42703' && filters.companyTypes.length) {
    return { jobs: [], total: 0, pageCount: 0, page: 1 };
  }

  if (error) raise(error, 'searching jobs');

  const total = count ?? 0;
  return {
    jobs: (data ?? []) as unknown as JobListItem[],
    total,
    pageCount: Math.max(1, Math.ceil(total / JOBS_PER_PAGE)),
    page: filters.page,
  };
});

/**
 * How many listings a set of filters matches, and nothing else — a HEAD
 * request, so no rows travel.
 *
 * For the no-results panel, which asks it once per filter the reader could
 * drop. Null rather than a throw on any failure: a suggestion that could not
 * be counted is a suggestion not shown, never a broken page.
 */
export async function countJobs(filters: JobFilters): Promise<number | null> {
  const supabase = await createClient();
  const resolved = await resolveFilters(filters);
  if (!resolved) return 0;

  let { count, error } = await applyFilters(supabase, filters, resolved, { head: true });
  if (resolved.tsquery && isMissingSearchDocuments(error)) {
    ({ count, error } = await applyFilters(supabase, filters, resolved, {
      head: true,
      legacy: true,
    }));
  }

  if (error) {
    logFailure('jobs', 'could not count a relaxed search', { code: error.code });
    return null;
  }
  return count ?? 0;
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

/**
 * What a role like this pays, if the board has enough listings to say.
 *
 * Returns null far more often than not, and that is the feature rather than a
 * shortcoming: the database refuses to answer below five live listings in the
 * bucket, so there is no partial number for this to soften into a hedge. A
 * caller that gets null renders nothing.
 *
 * Cached per request, because both the compensation card and anything else on
 * a listing page that wants the comparison ask the same question.
 *
 * Measured, because this runs on every listing page and usually answers
 * nothing — so the cost is paid whether or not there is anything to show. On a
 * board grown to 20,000 live listings (a thousand times today's) it is 2.7ms,
 * against 0.16ms for the board query beside it. The plan uses
 * `jobs_facets_idx` for the track and then rechecks 718 heap blocks for
 * status, expiry and the not-null salary.
 *
 * A partial covering index on (track, district_id, expires_at, basic_salary_min,
 * basic_salary_max) where status = 'active' and basic_salary_min is not null
 * would make it an index-only scan and take most of that away. Not added: 2.7ms
 * at a thousand times the data is not the 80ms the board index was worth, and
 * an index exists to be maintained on every write to `jobs`. Recorded so the
 * next person does not have to measure it again — and so that if this page ever
 * does get slow, the first thing to try is written down.
 */
export const salaryReference = cache(async function salaryReference(
  track: JobTrack,
  governorateId: number,
  client?: SupabaseLikeClient,
): Promise<SalaryReferenceRow | null> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase.rpc('salary_reference', {
    p_track: track,
    p_governorate_id: governorateId,
  });

  /*
    Swallowed rather than raised.

    Every other query in this file is something the page is about; this one is
    a nice-to-have beside the number the employer actually typed. A listing
    that fails to render because the market comparison could not be computed
    would be a worse page than one without the comparison.
  */
  if (error) {
    logFailure('jobs', 'could not read the salary reference', {
      track,
      governorate: governorateId,
      code: error.code,
    });
    return null;
  }

  return (data as SalaryReferenceRow[])?.[0] ?? null;
});
