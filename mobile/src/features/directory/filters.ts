import { useCallback } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { EMPTY_AGENT_FILTERS, serializeAgentFilters, type AgentFilters } from '@/lib/agent-filters';
import { localized } from '@/lib/locale';
import { useDistricts } from '~/features/taxonomy';

/**
 * The directory's filters live in the address, as on the website's /agents:
 * the route's parameters, read by the website's own parser
 * (parseAgentFilters), so a link to /agents?track=resale opens the same view.
 */

/** Every parameter the directory reads. A filter change names all of them. */
export const DIRECTORY_PARAMS = ['q', 'track', 'district', 'availability', 'years', 'page'] as const;

export type DirectoryParams = Record<(typeof DIRECTORY_PARAMS)[number], string | undefined>;

/** The website's experience floors — "n years or more", as search_agents() filters. */
export const MIN_YEARS_STEPS = [1, 3, 5, 10] as const;

/**
 * Filters as route parameters: the ones in use set, every other one
 * `undefined` so it is cleared. Several values of one filter are joined with
 * commas, which the parser reads the same as a repeated parameter.
 */
export function agentFiltersToParams(filters: AgentFilters): DirectoryParams {
  const search = serializeAgentFilters({ ...filters, page: 1 });
  const params = Object.fromEntries(DIRECTORY_PARAMS.map((key) => [key, undefined])) as DirectoryParams;
  for (const key of new Set(search.keys())) {
    if ((DIRECTORY_PARAMS as readonly string[]).includes(key)) {
      params[key as keyof DirectoryParams] = search.getAll(key).join(',');
    }
  }
  return params;
}

/** What the sheet edits: everything but the words, which are the search bar's. */
export function sheetFilterCount(filters: AgentFilters): number {
  return (
    filters.tracks.length +
    filters.districtSlugs.length +
    (filters.availability ? 1 : 0) +
    (filters.minYears ? 1 : 0)
  );
}

/** Every filter in use, the words included — the website's activeCount. */
export function activeFilterCount(filters: AgentFilters): number {
  return sheetFilterCount(filters) + (filters.q ? 1 : 0);
}

/** The sheet's groups cleared; the words kept. */
export function clearSheetFilters(filters: AgentFilters): AgentFilters {
  return { ...EMPTY_AGENT_FILTERS, q: filters.q };
}

export type ActiveAgentFilter = {
  key: string;
  kind: 'q' | 'availability' | 'years' | 'track' | 'district';
  value: string | number;
  /** The filters with only this one taken off. */
  without: Partial<AgentFilters>;
};

/** Each filter in use, as a chip that takes it off — in the order the website's rail lists them. */
export function activeAgentFilters(filters: AgentFilters): ActiveAgentFilter[] {
  const active: ActiveAgentFilter[] = [];
  if (filters.q) active.push({ key: 'q', kind: 'q', value: filters.q, without: { q: '' } });
  if (filters.availability) {
    active.push({ key: 'availability', kind: 'availability', value: filters.availability, without: { availability: null } });
  }
  if (filters.minYears) {
    active.push({ key: 'years', kind: 'years', value: filters.minYears, without: { minYears: null } });
  }
  for (const track of filters.tracks) {
    active.push({
      key: `track:${track}`,
      kind: 'track',
      value: track,
      without: { tracks: filters.tracks.filter((value) => value !== track) },
    });
  }
  for (const slug of filters.districtSlugs) {
    active.push({
      key: `district:${slug}`,
      kind: 'district',
      value: slug,
      without: { districtSlugs: filters.districtSlugs.filter((value) => value !== slug) },
    });
  }
  return active;
}

/** What a chip says, in the website's words for each filter. */
export function useAgentFilterLabel() {
  const locale = useLocale();
  const t = useTranslations();
  const { data: districts } = useDistricts();

  return useCallback(
    (filter: ActiveAgentFilter): string => {
      const value = String(filter.value);
      switch (filter.kind) {
        case 'q':
          return `«${value}»`;
        case 'availability':
          return t(`availability.${value}` as never);
        case 'years':
          return t('filters.minYears', { count: Number(filter.value) });
        case 'track':
          return t(`track.${value}` as never);
        case 'district': {
          const district = districts?.find((item) => item.slug === value);
          return district ? localized(locale, district.name_ar, district.name_en) : value;
        }
      }
    },
    [districts, locale, t],
  );
}
