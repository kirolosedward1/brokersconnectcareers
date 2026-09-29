import type { AgentAvailability, JobTrack } from '@/lib/supabase/database.types';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';

/**
 * The consultant directory's filters, as its address carries them — read and
 * written by the website's /agents page and its mobile endpoint, and by the
 * app, which builds the same address. Pure: no server, no Next.
 */

export type AgentFilters = {
  /** Words matched against what each card shows the viewer; see search_agents(). */
  q: string;
  tracks: JobTrack[];
  districtSlugs: string[];
  availability: AgentAvailability | null;
  minYears: number | null;
  page: number;
};

export const EMPTY_AGENT_FILTERS: AgentFilters = {
  q: '',
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
    q: (typeof searchParams.q === 'string' ? searchParams.q : '').trim().slice(0, 120),
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
  if (filters.q) params.set('q', filters.q);
  for (const track of filters.tracks) params.append('track', track);
  for (const district of filters.districtSlugs) params.append('district', district);
  if (filters.availability) params.set('availability', filters.availability);
  if (filters.minYears) params.set('years', String(filters.minYears));
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}
