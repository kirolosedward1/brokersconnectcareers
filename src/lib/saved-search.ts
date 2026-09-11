import type { JobFilters } from '@/lib/queries/jobs';

/**
 * The canonical form of a set of filters.
 *
 * Sorted keys, sorted values, no page and no sort. Two people arriving at the
 * same filters by different routes — one clicking chips, one editing the URL,
 * one on page 3 — produce the same string, which is what lets the unique
 * constraint treat "save this search" as idempotent rather than accumulating
 * near-duplicates that all send the same weekly email.
 */
export function toCanonicalQuery(filters: JobFilters): string {
  const params = new URLSearchParams();

  const add = (key: string, values: string[]) => {
    for (const value of [...values].sort()) params.append(key, value);
  };

  if (filters.q) params.set('q', filters.q);
  add('track', filters.tracks);
  add('leads', filters.leadsSources);
  add('exp', filters.experienceBands);
  add('type', filters.employmentTypes);
  add('district', filters.districtSlugs);
  if (filters.governorateSlug) params.set('gov', filters.governorateSlug);
  if (filters.hasBasicSalary === true) params.set('salary', 'yes');
  if (filters.hasBasicSalary === false) params.set('salary', 'no');
  if (filters.companySlug) params.set('company', filters.companySlug);

  // Sort the whole thing so key order cannot vary either.
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(sorted).toString();
}

/** Whether there is anything here worth saving. */
export function hasFilters(filters: JobFilters): boolean {
  return toCanonicalQuery(filters).length > 0;
}

/**
 * The canonical query for following one company, and its inverse.
 *
 * A follow is not a third concept: it is a saved search whose only filter is a
 * company. Written through the same canonicaliser as everything else so that
 * pressing Follow on the company page and saving `/jobs?company=<slug>` from
 * the board land on the same row rather than two that send the same email.
 */
export function followQuery(companySlug: string): string {
  return new URLSearchParams({ company: companySlug }).toString();
}

/**
 * The company a saved search follows, or null if it is an ordinary search.
 *
 * Exact rather than "contains a company": a search for one brokerage's junior
 * roles in Nasr City is a search, and showing it in the list as a follow would
 * promise alerts about roles it will never mention.
 */
export function followedCompany(query: string): string | null {
  const params = new URLSearchParams(query);
  const entries = [...params.entries()];
  if (entries.length !== 1) return null;
  const [[key, value]] = entries;
  return key === 'company' && value ? value : null;
}
