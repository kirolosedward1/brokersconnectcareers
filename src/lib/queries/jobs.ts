import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import { getDistricts, getGovernorates, getSearchPhrases } from './taxonomy';
import type {
  CompanyRow,
  DistrictRow,
  JobRow,
  JobTrack,
  SalaryReferenceRow,
} from '@/lib/supabase/database.types';
import { buildJobQuery, searchText } from '@/lib/search/arabic';
import { JOBS_PER_PAGE, type JobFilters } from '@/lib/job-filters';
import { LIST_SELECT, type JobDetail, type JobListItem } from '@/lib/job-list';
import { logFailure } from '@/lib/observe';

/** Anything shaped like the Supabase client's `.from()` entry point. */
type SupabaseLikeClient = Awaited<ReturnType<typeof createClient>>;

export {
  JOBS_PER_PAGE,
  EMPTY_FILTERS,
  parseJobFilters,
  serializeJobFilters,
  countActiveFilters,
} from '@/lib/job-filters';
export type { JobSort, JobFilters, SearchParams } from '@/lib/job-filters';

export { LIST_COLUMNS, LIST_SELECT } from '@/lib/job-list';
export type { JobListItem, JobDetail } from '@/lib/job-list';

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
 *
 * `pinSponsored: false` drops the paid placement from the order, for the
 * callers that ask "what is new" rather than show the board — the alerts. A
 * listing someone paid to pin is labelled as sponsored wherever the board
 * shows it pinned; an alert has no such label, and "published since you last
 * heard" is a promise about recency that a pinned listing would break.
 */
export const queryJobs = cache(async function queryJobs(
  filters: JobFilters,
  client?: SupabaseLikeClient,
  { pinSponsored = true }: { pinSponsored?: boolean } = {},
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
    // worthless if a sort change buries it. Disclosed where it is shown: each
    // card carries "Sponsored", and the board says sponsored listings come
    // first whenever one is on the page.
    if (pinSponsored) query = query.order('is_featured', { ascending: false });

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
export async function countJobs(
  filters: JobFilters,
  client?: SupabaseLikeClient,
): Promise<number | null> {
  // The same optional client queryJobs takes: the mobile board counts with the
  // anonymous one, so its answer is the same for every reader and cacheable.
  const supabase = client ?? (await createClient());
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
