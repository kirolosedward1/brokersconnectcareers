import { cache } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { raise } from './error';
import { createPublicClient } from '@/lib/supabase/public';
import { COMPANY_TYPES, JOB_TRACKS } from '@/lib/taxonomy';
import type { CompanyType, JobTrack } from '@/lib/supabase/database.types';

/**
 * How many live listings sit behind each way of browsing the board.
 *
 * One read, grouped here. The alternative was a count per track, per district
 * and per company type — twenty-odd round trips to draw one module on the home
 * page — or an RPC, which is a migration for something three narrow columns
 * already answer. The rows are a few dozen bytes each, so the home page pays
 * for one small query per thousand live listings.
 *
 * Read through the public client on purpose. A count is a claim about what the
 * reader will find when they click, so it has to be made under the same
 * row-level security an anonymous visitor's results are: a draft, a listing in
 * review and a suspended company's roles are invisible to this client and
 * therefore uncounted, without a rule about any of them being written here.
 * The two predicates below are the ones `queryJobs` applies, word for word,
 * which is what keeps "12" on the home page from opening a list of 11.
 *
 * Not cached across requests. A cached figure disagrees with the board for as
 * long as the cache lives, and the disagreement shows up exactly when somebody
 * is looking — a listing approved a minute ago that the home page has not
 * heard of. Per-request only, so two sections asking share one read.
 */
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

/**
 * Rows per request. Supabase's API answers at most 1,000 rows however many
 * are asked for, so the read pages through the board in steps of that size
 * rather than asking once and treating whatever came back as all of it.
 */
const PAGE = 1000;

type Row = {
  track: JobTrack;
  district_id: number;
  company?: { company_type: CompanyType | null } | null;
  /** How many listings the row stands for: 1 for a listing, n for a group. */
  listings?: number;
};

export const getBrowseCounts = cache(async function getBrowseCounts(): Promise<BrowseCounts> {
  const supabase = createPublicClient();

  /*
    The database groups them: one row per track x district x company type with
    a live listing — a few hundred at most, however large the board grows —
    under the same anonymous row-level security as before, since
    browse_counts() is invoker-rights (migration 300).

    This used to read every live listing and count in here: a thousand rows a
    round trip, three trips and 235 KB out of the database per home-page visit
    at 3,000 live listings, and linear in the board after that — on a plan
    where database egress is a monthly quota.
  */
  const grouped = await supabase.rpc('browse_counts');
  if (!grouped.error) {
    const rows = (grouped.data ?? []).map((row) => ({
      track: row.track,
      district_id: row.district_id,
      company: { company_type: (row.company_type as CompanyType | null) ?? null },
      listings: Number(row.listings),
    }));
    return tally(rows, true, rows.reduce((sum, row) => sum + row.listings, 0));
  }

  /*
    Before migration 300 reaches a database the function does not exist yet
    (PGRST202 from the API, 42883 from Postgres), and code reaches production
    before a migration as often as after. The row-by-row read below still
    answers correctly there, just expensively. Any other failure is a real one.
  */
  if (grouped.error.code !== 'PGRST202' && grouped.error.code !== '42883') {
    raise(grouped.error, 'counting live listings');
  }

  const now = new Date().toISOString();

  /*
    Every live row, a page at a time, plus the exact total.

    The first version asked once with a limit and reported the number of rows
    it got as the total. The API's own cap is 1,000 rows, so past that the
    home page would have said "1,000 jobs" over a board holding more, and
    every district and track below it would have been short too. The exact
    count comes from the database and is checked against the rows gathered, so
    the figures cannot quietly describe a sample. Ordered by id, so a listing
    published mid-read cannot shift the pages and be counted twice.
  */
  const read = async (
    select: string,
  ): Promise<
    | { data: unknown[]; error: null; total: number }
    | { data: null; error: PostgrestError; total?: undefined }
  > => {
    const rows: unknown[] = [];
    let total = 0;

    for (let from = 0; ; from += PAGE) {
      const { data, error, count } = await supabase
        .from('jobs')
        .select(select, { count: from === 0 ? 'exact' : undefined })
        .eq('status', 'active')
        .gt('expires_at', now)
        .order('id')
        .range(from, from + PAGE - 1);

      if (error) return { data: null, error };
      if (from === 0) total = count ?? 0;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE || rows.length >= total) break;
    }

    return { data: rows, error: null, total };
  };

  /*
    With the company's type if the column is there, without it if not.

    Code reaches production before a migration does as often as after, and a
    select naming a column that does not exist fails the whole read — which
    would take the district and track groups down with the one group that
    actually depends on it.
  */
  let typed = true;
  let result = await read('track, district_id, company:companies!inner (company_type)');

  if (result.error) {
    typed = false;
    result = await read('track, district_id');
  }
  if (result.error) raise(result.error, 'counting live listings');

  const rows = (result.data ?? []) as unknown as Row[];
  return tally(rows, typed, result.total ?? rows.length);
});

/** Listings, or groups of them, folded into the figures the browse module draws. */
function tally(rows: Row[], typed: boolean, total: number): BrowseCounts {
  const byTrack = new Map<JobTrack, number>();
  const byDistrict = new Map<number, number>();
  const byType = new Map<CompanyType, number>();
  const byPair = new Map<string, { track: JobTrack; districtId: number; count: number }>();

  for (const row of rows) {
    const n = row.listings ?? 1;
    byTrack.set(row.track, (byTrack.get(row.track) ?? 0) + n);
    byDistrict.set(row.district_id, (byDistrict.get(row.district_id) ?? 0) + n);
    const key = `${row.track}:${row.district_id}`;
    const pair = byPair.get(key) ?? { track: row.track, districtId: row.district_id, count: 0 };
    pair.count += n;
    byPair.set(key, pair);
    const type = row.company?.company_type;
    if (type) byType.set(type, (byType.get(type) ?? 0) + n);
  }

  /*
    Most listings first, and then an order that cannot change on its own.

    Count alone ties constantly on a young board — five districts with one
    listing each — and a tie broken by whatever order the database returned is
    a home page that reshuffles between two visits. Tracks fall back to the
    taxonomy's own order, districts to their id.
  */
  return {
    // The database's count, which is what the board will report on arrival.
    total,
    tracks: JOB_TRACKS.filter((track) => byTrack.has(track))
      .map((track) => ({ track, count: byTrack.get(track)! }))
      .sort((a, b) => b.count - a.count),
    districts: [...byDistrict.entries()]
      .map(([districtId, count]) => ({ districtId, count }))
      .sort((a, b) => b.count - a.count || a.districtId - b.districtId),
    companyTypes: typed
      ? COMPANY_TYPES.filter((type) => byType.has(type)).map((type) => ({
          type,
          count: byType.get(type)!,
        }))
      : null,
    pairs: [...byPair.values()].sort(
      (a, b) =>
        b.count - a.count ||
        JOB_TRACKS.indexOf(a.track) - JOB_TRACKS.indexOf(b.track) ||
        a.districtId - b.districtId,
    ),
  };
}

/**
 * What the live listings on one track-in-district page have in common, read
 * from the listings themselves.
 *
 * This is what makes the page more than a filtered board with a heading: a
 * reader searching "primary sales jobs in New Cairo" learns how many
 * companies are hiring there, how many of the roles pay a basic salary and
 * what range those salaries span — each a count or a bound over rows that
 * are on the page, never an estimate. A figure with nothing under it is left
 * out by the caller rather than shown as zero.
 */
export type LandingFacts = {
  listings: number;
  companies: number;
  withBasicSalary: number;
  salaryFloor: number | null;
  salaryCeiling: number | null;
};

export const getLandingFacts = cache(async function getLandingFacts(
  track: JobTrack,
  districtId: number,
): Promise<LandingFacts> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('jobs')
    .select('company_id, basic_salary_min, basic_salary_max')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .eq('track', track)
    .eq('district_id', districtId)
    .limit(PAGE);

  if (error) raise(error, 'summarising a landing page');

  const rows = data ?? [];
  const salaried = rows.filter(
    (row) => (row.basic_salary_min ?? 0) > 0 || (row.basic_salary_max ?? 0) > 0,
  );
  const floors = salaried.map((row) => row.basic_salary_min ?? row.basic_salary_max!).filter((n) => n > 0);
  const ceilings = salaried.map((row) => row.basic_salary_max ?? row.basic_salary_min!).filter((n) => n > 0);

  return {
    listings: rows.length,
    companies: new Set(rows.map((row) => row.company_id)).size,
    withBasicSalary: salaried.length,
    salaryFloor: floors.length ? Math.min(...floors) : null,
    salaryCeiling: ceilings.length ? Math.max(...ceilings) : null,
  };
});
