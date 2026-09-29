import { mobileJson, publicRead } from '@/lib/mobile-api/http';
import { getLandingFacts } from '@/lib/queries/browse';
import { getDistrictBySlug } from '@/lib/queries/taxonomy';
import { parseLandingSlug } from '@/lib/taxonomy';
import type { LandingResponse } from '@/lib/mobile-api/reads';

/**
 * GET /api/mobile/v1/landing/<track>-<district> — the facts a track-in-a-district
 * page leads with: how many live listings, how many companies, how many state a
 * basic salary, and its range.
 *
 * The listings themselves are the board, filtered: the app asks
 * /jobs?track=<track>&district=<district> for those.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ slug: string }> };

export const GET = publicRead<Context>(async (_request, { params }) => {
  const { slug } = await params;
  const parsed = parseLandingSlug(slug);
  const district = parsed ? await getDistrictBySlug(parsed.districtSlug) : null;
  if (!parsed || !district) return mobileJson({ error: 'not_found' }, { status: 404 });

  return {
    track: parsed.track,
    district: {
      id: district.id,
      slug: district.slug,
      name_ar: district.name_ar,
      name_en: district.name_en,
    },
    facts: await getLandingFacts(parsed.track, district.id),
  } satisfies LandingResponse;
});
