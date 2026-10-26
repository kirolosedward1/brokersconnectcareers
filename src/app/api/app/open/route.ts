import { NextResponse } from 'next/server';
import { storeRedirectTarget } from '@/lib/app-links';

export const dynamic = 'force-dynamic';

/**
 * The one address a results-page QR will encode, once that card draws one.
 *
 * An iPhone is sent to the App Store and an Android phone to Google
 * Play, when that listing is set (lib/app-links.ts). Not cached: a
 * shared cache would hand an iPhone the redirect it stored for a
 * laptop. Not indexed: it is a door, not a page.
 */
export function GET(request: Request) {
  const target = storeRedirectTarget(request.headers.get('user-agent') ?? '');
  return NextResponse.redirect(new URL(target, request.url), {
    status: 302,
    headers: {
      'cache-control': 'private, no-store',
      vary: 'user-agent',
      'x-robots-tag': 'noindex',
    },
  });
}
