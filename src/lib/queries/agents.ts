import { createClient } from '@/lib/supabase/server';
import { raise } from './error';
import { JOB_TRACKS, AVAILABILITIES } from '@/lib/taxonomy';
import { getDistricts } from './taxonomy';
import type {
  AgentAvailability,
  AgentCardDetail,
  AgentCardRow,
  JobTrack,
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
}> {
  const supabase = await createClient();
  const districts = await getDistricts();

  const districtIds = filters.districtSlugs.length
    ? districts.filter((d) => filters.districtSlugs.includes(d.slug)).map((d) => d.id)
    : null;

  const { data, error } = await supabase.rpc('search_agents', {
    p_tracks: filters.tracks.length ? filters.tracks : null,
    p_district_ids: districtIds,
    p_availability: filters.availability,
    p_min_years: filters.minYears,
    p_limit: AGENTS_PER_PAGE,
    p_offset: (filters.page - 1) * AGENTS_PER_PAGE,
  });

  if (error) raise(error, 'searching the agent directory');

  const agents = (data ?? []) as AgentCardRow[];
  const total = agents[0]?.total_count ? Number(agents[0].total_count) : 0;

  return { agents, total, pageCount: Math.max(1, Math.ceil(total / AGENTS_PER_PAGE)) };
}

export async function getAgentCard(slug: string): Promise<AgentCardDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_agent_card', { p_slug: slug });
  if (error) raise(error, 'loading an agent profile');
  return (data as AgentCardDetail[])?.[0] ?? null;
}
