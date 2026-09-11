import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import { JOB_TRACKS, AVAILABILITIES } from '@/lib/taxonomy';
import { getDistricts } from './taxonomy';
import type {
  AgentAvailability,
  AgentCardDetail,
  AgentCardRow,
  JobTrack,
  SavedAgentCardRow,
} from '@/lib/supabase/database.types';

export const AGENTS_PER_PAGE = 24;

export type AgentFilters = {
  tracks: JobTrack[];
  districtSlugs: string[];
  availability: AgentAvailability | null;
  minYears: number | null;
  page: number;
};

export const EMPTY_AGENT_FILTERS: AgentFilters = {
  tracks: [],
  districtSlugs: [],
  availability: null,
  minYears: null,
  page: 1,
};

type SearchParams = Record<string, string | string[] | undefined>;

function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(',')).filter(Boolean);
}

export function parseAgentFilters(searchParams: SearchParams): AgentFilters {
  const availability = typeof searchParams.availability === 'string' ? searchParams.availability : null;
  const minYears = Number.parseInt(String(searchParams.years ?? ''), 10);
  const page = Number.parseInt(String(searchParams.page ?? '1'), 10);

  return {
    tracks: many(searchParams.track).filter((v): v is JobTrack =>
      (JOB_TRACKS as readonly string[]).includes(v),
    ),
    districtSlugs: many(searchParams.district).slice(0, 12),
    availability: (AVAILABILITIES as readonly string[]).includes(availability ?? '')
      ? (availability as AgentAvailability)
      : null,
    minYears: Number.isFinite(minYears) && minYears > 0 ? Math.min(minYears, 40) : null,
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 200) : 1,
  };
}

export function serializeAgentFilters(filters: AgentFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const track of filters.tracks) params.append('track', track);
  for (const district of filters.districtSlugs) params.append('district', district);
  if (filters.availability) params.set('availability', filters.availability);
  if (filters.minYears) params.set('years', String(filters.minYears));
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/**
 * Directory results come from a SECURITY DEFINER function, not a table read.
 * RLS hides gated rows outright — correct for the profile page, useless for a
 * directory that must show anonymised cards to everyone. The function decides
 * what to reveal, so the gate cannot be bypassed by crafting a query.
 */
export async function queryAgents(filters: AgentFilters): Promise<{
  agents: AgentCardRow[];
  total: number;
  pageCount: number;
  /** The page actually returned, which is not always the one asked for. */
  page: number;
}> {
  const supabase = await createClient();
  const districts = await getDistricts();

  const districtIds = filters.districtSlugs.length
    ? districts.filter((d) => filters.districtSlugs.includes(d.slug)).map((d) => d.id)
    : null;

  const pageOf = (page: number) =>
    supabase.rpc('search_agents', {
      p_tracks: filters.tracks.length ? filters.tracks : null,
      p_district_ids: districtIds,
      p_availability: filters.availability,
      p_min_years: filters.minYears,
      p_limit: AGENTS_PER_PAGE,
      p_offset: (page - 1) * AGENTS_PER_PAGE,
    });

  const { data, error } = await pageOf(filters.page);
  if (error) raise(error, 'searching the agent directory');

  const agents = (data ?? []) as AgentCardRow[];

  /*
    A page past the end is answered with the end, not with "nobody matches".

    The total rides along on each row (`count(*) over ()`), so a page with no
    rows carries no total either — which made `?page=99` report zero
    consultants and render the empty panel: "مفيش استشاريين مطابقين لبحثك", on
    an unfiltered directory of seven people. The board had the same bug and
    round 3 fixed it there; this side was never revisited, and the shortlist
    page inherited the shape from here.

    Page one always exists, so ask it how many there are and go to the last
    page from the answer.
  */
  if (filters.page > 1 && agents.length === 0) {
    const { data: first, error: firstError } = await pageOf(1);
    if (firstError) raise(firstError, 'searching the agent directory');

    const rows = (first ?? []) as AgentCardRow[];
    const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
    const pageCount = Math.max(1, Math.ceil(total / AGENTS_PER_PAGE));

    if (pageCount <= 1) return { agents: rows, total, pageCount, page: 1 };

    const { data: last, error: lastError } = await pageOf(pageCount);
    if (lastError) raise(lastError, 'searching the agent directory');

    return { agents: (last ?? []) as AgentCardRow[], total, pageCount, page: pageCount };
  }

  const total = agents[0]?.total_count ? Number(agents[0].total_count) : 0;

  return {
    agents,
    total,
    pageCount: Math.max(1, Math.ceil(total / AGENTS_PER_PAGE)),
    page: filters.page,
  };
}

export async function getAgentCard(slug: string): Promise<AgentCardDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_agent_card', { p_slug: slug });
  if (error) raise(error, 'loading an agent profile');
  return (data as AgentCardDetail[])?.[0] ?? null;
}

export const SAVED_AGENTS_PER_PAGE = 24;

/**
 * The company's shortlist.
 *
 * Through the same kind of definer function the directory uses, and for the
 * same reason: a plain table read would answer with what was true when each
 * row was written. A consultant who has since switched to `hidden` has left
 * the directory, and a list that kept showing their name would be a copy of
 * the directory taken before they went. The function re-derives it, so this
 * only has to render what it is handed.
 */
export async function querySavedAgents(requested = 1): Promise<{
  agents: SavedAgentCardRow[];
  total: number;
  pageCount: number;
  /** The page actually returned, which is not always the one asked for. */
  page: number;
}> {
  const supabase = await createClient();

  const pageOf = (page: number) =>
    supabase.rpc('saved_agent_cards', {
      p_limit: SAVED_AGENTS_PER_PAGE,
      p_offset: (page - 1) * SAVED_AGENTS_PER_PAGE,
    });

  const { data, error } = await pageOf(requested);
  if (error) raise(error, 'loading the shortlist');

  const agents = (data ?? []) as SavedAgentCardRow[];

  // Same recovery as the directory above, for the same reason: an empty page
  // carries no total, so `?page=9` would have told a company with two hundred
  // shortlisted consultants that its shortlist was empty.
  if (requested > 1 && agents.length === 0) {
    const { data: first, error: firstError } = await pageOf(1);
    if (firstError) raise(firstError, 'loading the shortlist');

    const rows = (first ?? []) as SavedAgentCardRow[];
    const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
    const pageCount = Math.max(1, Math.ceil(total / SAVED_AGENTS_PER_PAGE));

    if (pageCount <= 1) return { agents: rows, total, pageCount, page: 1 };

    const { data: last, error: lastError } = await pageOf(pageCount);
    if (lastError) raise(lastError, 'loading the shortlist');

    return { agents: (last ?? []) as SavedAgentCardRow[], total, pageCount, page: pageCount };
  }

  const total = agents[0]?.total_count ? Number(agents[0].total_count) : 0;

  return {
    agents,
    total,
    pageCount: Math.max(1, Math.ceil(total / SAVED_AGENTS_PER_PAGE)),
    page: requested,
  };
}

/**
 * Which of the consultants on this page the viewer's company already keeps.
 *
 * One small read keyed to the ids on screen rather than a column folded into
 * the directory query — /agents is public and the same result set is shown to
 * everyone, and making it per-reader would give that up for a bookmark.
 *
 * Scoped to `my_company_id()` explicitly, with row-level security still behind
 * it. Not a second copy of the policy: the policy answers "may this person see
 * this row", which for somebody who belongs to two companies is yes to both —
 * while the write and the shortlist page both act on exactly one company, the
 * one `my_company_id()` picks. Left to the policy alone, a colleague in two
 * brokerages would see a consultant marked as kept because the *other*
 * brokerage kept them, and the shortlist they were looking at would not list
 * them. Rare, and silently wrong, which is the combination worth one filter.
 */
export async function shortlistedAgentIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();

  const supabase = await createClient();

  const { data: companyId } = await supabase.rpc('my_company_id');
  if (!companyId) return new Set();

  const { data } = await supabase
    .from('saved_agents')
    .select('agent_id')
    .eq('company_id', companyId)
    .in('agent_id', ids);

  return new Set((data ?? []).map((row) => row.agent_id));
}
