import type { NextRequest } from 'next/server';
import { mobileJson, withMobileAuth } from '@/lib/mobile-api/http';
import { getJobBySlug, getSimilarJobs } from '@/lib/queries/jobs';

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

    const similar = await getSimilarJobs(job);
    return mobileJson({ job, similar });
  },
  { optional: true },
);
