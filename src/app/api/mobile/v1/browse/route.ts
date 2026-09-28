import { publicRead } from '@/lib/mobile-api/http';
import { getBrowseCounts } from '@/lib/queries/browse';

/**
 * GET /api/mobile/v1/browse — the counts the home screen browses by: live
 * listings per track, per district, per company type, and the track × district
 * pairs that have something on them (the landing pages worth linking to).
 *
 * The website's home page reads exactly this. Names come from the taxonomies,
 * which the app reads itself and keeps for a day.
 */
export const dynamic = 'force-dynamic';

export const GET = publicRead(async () => getBrowseCounts());
