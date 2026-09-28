import { publicRead } from '@/lib/mobile-api/http';
import { queryCompanies } from '@/lib/queries/companies';
import { getDistrictBySlug } from '@/lib/queries/taxonomy';

/**
 * GET /api/mobile/v1/companies?q=&district=<slug>&verified=1&page= — the
 * company directory: companies with at least one live listing, 24 a page.
 *
 * The website's /companies page, parameter for parameter and bound for bound,
 * over the same query. Anonymous and shared, like the board.
 */
export const dynamic = 'force-dynamic';

export const GET = publicRead(async (request) => {
  const params = request.nextUrl.searchParams;

  const q = (params.get('q') ?? '').trim().slice(0, 120) || undefined;
  const district = params.get('district');
  const districtId = district ? (await getDistrictBySlug(district))?.id : undefined;
  const page = Math.min(500, Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1));

  return queryCompanies({ q, districtId, verifiedOnly: params.get('verified') === '1', page });
});
