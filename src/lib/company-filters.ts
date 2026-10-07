/**
 * The directory's address for a view of it: the search, the district, the
 * verified switch and the page, each only when it narrows something.
 *
 * Pure, so the pager and its test agree. The pager built its links from the
 * search and the page alone, so page 2 of "verified companies in New Cairo"
 * was page 2 of the whole directory, with the district select reset.
 */
export function companiesHref({
  q,
  district,
  verified,
  page = 1,
}: {
  q?: string | null;
  district?: string | null;
  verified?: boolean;
  page?: number;
}): string {
  const search = new URLSearchParams();
  if (q) search.set('q', q);
  if (district) search.set('district', district);
  if (verified) search.set('verified', '1');
  if (page > 1) search.set('page', String(page));
  const query = search.toString();
  return query ? `/companies?${query}` : '/companies';
}
