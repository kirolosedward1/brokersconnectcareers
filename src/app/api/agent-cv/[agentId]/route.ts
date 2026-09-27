import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { CV_BUCKET, signedUrl } from '@/lib/storage';
import { logFailure } from '@/lib/observe';
import type { AgentCardDetail } from '@/lib/supabase/database.types';

/**
 * Hands a directory reader a consultant's CV, the way /api/cv hands an
 * employer an applicant's.
 *
 * The profile page used to mint a ten-minute signed URL and print it into the
 * HTML. Ten minutes is short, but a URL in a page outlives the page: it sits
 * in the browser history, survives a copied link and a screenshot, and is the
 * one thing on the profile that is not re-checked against the viewer. Minted
 * per request and redirected to, it is checked every time.
 *
 * get_agent_card() does the authorising. It returns cv_path only when this
 * viewer is entitled to the card — the directory rule, or the owner — so its
 * presence in the answer is the permission, exactly as the page treats it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  if (!z.string().uuid().safeParse(agentId).success) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { data, error } = await supabase.rpc('get_agent_card', { p_slug: agentId });

  if (error) {
    logFailure('cv', 'could not read the card behind a CV link', {
      agent: agentId,
      code: error.code,
    });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const card = (data as AgentCardDetail[] | null)?.[0];
  if (!card?.cv_path) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = await signedUrl(CV_BUCKET, card.cv_path, 300);
  if (!url) {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
