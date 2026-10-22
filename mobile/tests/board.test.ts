import { EMPTY_FILTERS, parseJobFilters, type JobFilters } from '@/lib/job-filters';
import type { JobListItem } from '@/lib/job-list';
import type { JobBoardResponse } from '@/lib/mobile-api/reads';
import {
  boardQuery,
  BOARD_PARAMS,
  clearSheetFilters,
  filtersToParams,
  sheetFilterCount,
  toggled,
} from '~/features/jobs/filters';
import { flattenBoard } from '~/features/jobs/queries';

const job = (id: string) => ({ id, slug: `job-${id}` }) as JobListItem;
const page = (page: number, ids: string[], pageCount = 3): JobBoardResponse => ({
  jobs: ids.map(job),
  total: 60,
  page,
  pageCount,
  pageSize: 20,
  relaxations: [],
  company: null,
});

describe('flattenBoard', () => {
  it('draws each listing once when offsets shift between pages', () => {
    // A listing published between two loads pushes "b" onto page 2 as well.
    const jobs = flattenBoard([page(1, ['a', 'b']), page(2, ['b', 'c'])]);
    expect(jobs.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('is empty before anything has loaded', () => {
    expect(flattenBoard(undefined)).toEqual([]);
  });
});

describe('filters in the route', () => {
  const filters: JobFilters = {
    ...EMPTY_FILTERS,
    q: 'استشاري, مبيعات',
    tracks: ['primary', 'resale'],
    districtSlugs: ['new-cairo'],
    minSalary: 10000,
    hasBasicSalary: true,
    companySlug: 'nile-brokers',
    sort: 'salary',
    page: 4,
  };

  it('names every board parameter, clearing the ones not in use', () => {
    const params = filtersToParams(filters);
    expect(Object.keys(params).sort()).toEqual([...BOARD_PARAMS].sort());
    expect(params).toMatchObject({
      q: 'استشاري, مبيعات',
      track: 'primary,resale',
      district: 'new-cairo',
      pay: '10000',
      salary: 'yes',
      company: 'nile-brokers',
      sort: 'salary',
      gov: undefined,
      leads: undefined,
    });
  });

  it('starts a changed board at its first page', () => {
    expect(filtersToParams(filters).page).toBeUndefined();
  });

  it('reads back as the same filters through the website parser', () => {
    const params = Object.fromEntries(
      Object.entries(filtersToParams(filters)).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
    expect(parseJobFilters(params)).toEqual({ ...filters, page: 1 });
  });

  it('keys one filter set once, however it was reached', () => {
    const a = parseJobFilters({ track: ['resale', 'primary'], district: 'new-cairo', page: '3' });
    const b = parseJobFilters({ track: 'resale,primary', district: 'new-cairo' });
    expect(boardQuery(a)).toBe(boardQuery(b));
    expect(boardQuery(EMPTY_FILTERS)).toBe('');
  });
});

describe('the filter sheet', () => {
  const narrowed = parseJobFilters({
    q: 'مبيعات',
    company: 'nile-brokers',
    gov: 'cairo',
    track: 'primary,resale',
    pay: '10000',
    sort: 'salary',
  });

  it('counts only what it edits — the words and its groups, not the company or the governorate', () => {
    expect(sheetFilterCount(narrowed)).toBe(4);
    expect(sheetFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('clears the words and its own groups, and keeps the rest', () => {
    const cleared: JobFilters = clearSheetFilters(narrowed);
    expect(cleared).toEqual({
      ...EMPTY_FILTERS,
      companySlug: 'nile-brokers',
      governorateSlug: 'cairo',
      sort: 'salary',
    });
  });

  it('toggles a value in and out of a multi-select', () => {
    expect(toggled(['primary'], 'resale')).toEqual(['primary', 'resale']);
    expect(toggled(['primary', 'resale'], 'primary')).toEqual(['resale']);
  });
});
