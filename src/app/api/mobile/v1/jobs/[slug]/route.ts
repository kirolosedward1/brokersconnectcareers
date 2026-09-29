import type { NextRequest } from 'next/server';
import { mobileJson, withMobileAuth } from '@/lib/mobile-api/http';
import { getJobBySlug, getSimilarJobs, salaryReference } from '@/lib/queries/jobs';
import type { JobDetailResponse } from '@/lib/mobile-api/reads';

/**
 * GET /api/mobile/v1/jobs/<slug> — one listing, as its reader may see it.
 *
 * Read under the caller's token when there is one, because what a listing is
 * depends on who asks: its owner previews a draft, somebody who applied still
 * sees a listing that has since closed, and a signed-out reader sees live,
 * expired and closed ones only. So it is `no-store`, unlike the board.
 *
 * Landing slugs (`<track>-<district>`) are not listings; the app recognises
 * them with parseLandingSlug() and asks /landing/<slug> instead.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ slug: string }> };

export const GET = withMobileAuth<Context>(
  async (_request: NextRequest, { params }) => {
    const { slug } = await params;
    if (!/^[a-z0-9-]{1,200}$/.test(slug)) return mobileJson({ error: 'not_found' }, { status: 404 });

    const job = await getJobBySlug(slug);
    if (!job) return mobileJson({ error: 'not_found' }, { status: 404 });

    // The page's own pair of reads, side by side as there: roles like this
    // one, and what listings like it pay (null below five of them).
    const [similar, reference] = await Promise.all([
      getSimilarJobs(job),
      salaryReference(job.track, job.district.governorate_id),
    ]);
    return mobileJson({ job, similar, reference } satisfies JobDetailResponse);
  },
  { optional: true },
);
