import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CV_BUCKET, signedUrl } from '@/lib/storage';
import { rateLimit, policyFor } from '@/lib/security/rate-limit';
import { recordSecurityEvent } from '@/lib/security/events';
import { retryAfter } from '@/lib/security/request';
import { logFailure } from '@/lib/observe';
import { wantsJson, withOptionalBearer } from '@/lib/mobile-api/http';

export const dynamic = 'force-dynamic';

const HANDLE = /^(?:[a-z0-9][a-z0-9-]{0,118}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * A consultant's CV, for a viewer the database says may have it.
 *
 * The same door the contact goes through: reveal_agent_contact() decides —
 * signed in, acting for a company in good standing, card open, within the
 * day's allowance — and a second opening of the same card within a day is
 * not a second reveal, so pressing Contact and then Download CV costs one.
 * The signed URL lives five minutes and is redirected to, never rendered.
 *
 * Every refusal is a 404 to the caller. Whether a card exists, whether it is
 * locked to this company and whether a CV was attached are three facts a
 * stranger is not owed; the signed-in page already told the entitled reader
 * what it could.
 */
async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  if (!HANDLE.test(handle)) return notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const policy = await policyFor('cv_download:user:hour', { windowSeconds: 3600, max: 60 });
  const limit = await rateLimit(`cv_download:user:${user.id}`, policy);
  if (!limit.allowed) {
    void recordSecurityEvent('cv.download_rate_limited', {
      severity: 'warning',
      actorId: user.id,
      metadata: { source: 'agent_cv' },
    });
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { 'retry-after': retryAfter(limit.retryAfterSeconds), 'cache-control': 'no-store' } },
    );
  }

  const { data, error } = await supabase.rpc('reveal_agent_contact', { p_handle: handle });
  if (error) {
    logFailure('cv', 'could not resolve a consultant CV', { by: user.id, code: error.code });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const row = data?.[0];
  if (!row || row.status !== 'ok' || !row.cv_path) return notFound();

  const url = await signedUrl(CV_BUCKET, row.cv_path, 300);
  if (!url) return NextResponse.json({ error: 'unavailable' }, { status: 500 });

  // The app opens the file in its own viewer, so it asks for the link itself.
  if (wantsJson(request)) {
    return NextResponse.json({ url }, { headers: { 'cache-control': 'no-store, private' } });
  }

  return NextResponse.redirect(url, { headers: { 'cache-control': 'no-store, private' } });
}

/* The website's cookie, or the mobile app's bearer token — never both. */
export const GET = withOptionalBearer(handle);

function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
}
