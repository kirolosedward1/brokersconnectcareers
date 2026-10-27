import { NextResponse } from 'next/server';
import { saveFirstTouch } from '@/lib/actions/attribution';
import { isSameOriginPost } from '@/lib/auth/confirm-link';

export const dynamic = 'force-dynamic';

const headers = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
};

/**
 * Copy this browser's first visit onto the signed-in account.
 *
 * The console asks once, after sign-in. Calling the server action from that
 * layout races the streamed shell (`(app)/loading.tsx`) and the app router
 * throws React error 310 while /admin is on screen, so this is an ordinary
 * POST of the same body. An empty body falls through to the cookie.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!isSameOriginPost(request.headers.get('origin'), request.headers.get('sec-fetch-site'), url.origin)) {
    return NextResponse.json({ ok: false }, { status: 403, headers });
  }
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const result = await saveFirstTouch(body);
  return NextResponse.json(result, { headers });
}
