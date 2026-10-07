import { useCallback } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import {
  countActiveFilters,
  EMPTY_FILTERS,
  serializeJobFilters,
  type ActiveFilter,
  type JobFilters,
} from '@/lib/job-filters';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { useDistricts, useGovernorates } from '~/features/taxonomy';

/**
 * The board's filters live where the website keeps them: in the address. On
 * the phone that is the route's parameters, so a link from the site, a push,
 * the home screen's "by district" and a filter the reader picks all arrive the
 * same way and are read by the website's own parser (parseJobFilters).
 */

/** Every parameter the board reads. A filter change names all of them. */
export const BOARD_PARAMS = [
  'q',
  'track',
  'leads',
  'exp',
  'type',
  'district',
  'gov',
  'salary',
  'pay',
  'comm',
  'posted',
  'company',
  'ctype',
  'sort',
  'page',
] as const;

export type BoardParams = Record<(typeof BOARD_PARAMS)[number], string | undefined>;

/**
 * Filters as route parameters for router.setParams: the ones in use set, every
 * other one `undefined` so it is cleared rather than kept from before. Several
 * values of one filter are joined with commas, which parseJobFilters reads the
 * same as a repeated parameter — the form the website's own links take.
 */
export function filtersToParams(filters: JobFilters): BoardParams {
  const search = serializeJobFilters({ ...filters, page: 1 });
  const params = Object.fromEntries(BOARD_PARAMS.map((key) => [key, undefined])) as BoardParams;
  for (const key of new Set(search.keys())) {
    if ((BOARD_PARAMS as readonly string[]).includes(key)) {
      params[key as keyof BoardParams] = search.getAll(key).join(',');
    }
  }
  return params;
}

/**
 * What the filter sheet edits: the words and every group the website's filter
 * panel has. Not a company or a governorate, which only a link sets — each has
 * its own chip to take it off.
 */
export function sheetFilterCount(filters: JobFilters): number {
  return countActiveFilters(filters) - (filters.companySlug ? 1 : 0) - (filters.governorateSlug ? 1 : 0);
}

/** The sheet cleared, the words with it; the company, the governorate and the order kept. */
export function clearSheetFilters(filters: JobFilters): JobFilters {
  return {
    ...EMPTY_FILTERS,
    companySlug: filters.companySlug,
    governorateSlug: filters.governorateSlug,
    sort: filters.sort,
  };
}

/** A value in a multi-select, taken out if it was in, put in if it was not. */
export function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((existing) => existing !== value) : [...values, value];
}

/**
 * One filter set's canonical query string, page left out: the key the board is
 * cached under, however the filters were reached.
 */
export function boardQuery(filters: JobFilters): string {
  return serializeJobFilters({ ...filters, page: 1 }).toString();
}

/**
 * What a chip says — the website's labelFor(), in the same words: the reader's
 * own search in «quotes», a track, a place, "10,000 EGP or more", "last 7 days".
 */
export function useFilterLabel(filters: JobFilters) {
  const locale = useLocale();
  const tTrack = useTranslations('track');
  const tLeads = useTranslations('leadsSource');
  const tExp = useTranslations('experienceBand');
  const tType = useTranslations('employmentType');
  const tFilters = useTranslations('filters');
  const tCompanyType = useTranslations('companyType');
  const tCommission = useTranslations('commissionType');
  const { data: districts } = useDistricts();
  const { data: governorates } = useGovernorates();

  return useCallback(
    (filter: ActiveFilter): string => {
      const value = String(filter.value);
      switch (filter.kind) {
        case 'q':
          return `«${value}»`;
        case 'track':
          return tTrack(value as never);
        case 'district': {
          const district = districts?.find((item) => item.slug === value);
          return district ? localized(locale, district.name_ar, district.name_en) : value;
        }
        case 'gov': {
          const governorate = governorates?.find((item) => item.slug === filters.governorateSlug);
          return governorate ? localized(locale, governorate.name_ar, governorate.name_en) : value;
        }
        case 'ctype':
          return tCompanyType(value as never);
        case 'leads':
          return tLeads(`${value}_short` as never);
        case 'salary':
          return tFilters(filter.value ? 'hasBasicSalaryYes' : 'hasBasicSalaryNo');
        case 'pay':
          return tFilters('minSalaryAtLeast', { amount: formatNumber(Number(filter.value), locale) });
        case 'comm':
          return tCommission(value as never);
        case 'posted':
          return tFilters('postedWithin', { days: Number(filter.value) });
        case 'exp':
          return tExp(value as never);
        case 'type':
          return tType(value as never);
      }
    },
    [locale, districts, governorates, filters.governorateSlug, tTrack, tLeads, tExp, tType, tFilters, tCompanyType, tCommission],
  );
}
