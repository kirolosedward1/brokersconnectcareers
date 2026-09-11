import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CV_BUCKET, signedUrl } from '@/lib/storage';
import { logFailure } from '@/lib/observe';

/**
 * Hands an employer a CV without ever giving them read access to the bucket.
 *
 * The signed URL is minted per request and redirected to, rather than rendered
 * into the page — a URL in the HTML would outlive the session, survive a copied
 * screenshot, and be shareable with anyone.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  const { applicationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  /*
    RLS on applications already restricts this read to the candidate who filed
    it and the employer who owns the job. If the row comes back, the caller is
    entitled to the file.

    But a failed read is not "not entitled" and it is not "no CV attached" —
    which is what the 404 below said, to an employer looking at a card that
    tells them a CV is there. `maybeSingle()` reports no error for no row, so
    the two are separable: 404 keeps meaning there is nothing to fetch, and a
    real failure says so with a 503 the caller can retry.
  */
  const { data: application, error } = await supabase
    .from('applications')
    .select('cv_path')
    .eq('id', applicationId)
    .maybeSingle();

  if (error) {
    logFailure('cv', 'could not read the application behind a CV link', {
      application: applicationId,
      code: error.code,
    });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  if (!application?.cv_path) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = await signedUrl(CV_BUCKET, application.cv_path, 300);
  if (!url) {
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }

  return NextResponse.redirect(url, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
