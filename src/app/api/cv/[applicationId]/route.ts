import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CV_BUCKET, signedUrl } from '@/lib/storage';

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

  // RLS on applications already restricts this read to the candidate who filed
  // it and the employer who owns the job. If the row comes back, the caller is
  // entitled to the file.
  const { data: application } = await supabase
    .from('applications')
    .select('cv_path')
    .eq('id', applicationId)
    .maybeSingle();

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
