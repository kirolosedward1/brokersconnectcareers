import { NextResponse } from 'next/server';
import { appSiteAssociation, parseAppIds } from '@/lib/apple/app-site-association';

/**
 * GET /.well-known/apple-app-site-association — which links open the iOS app
 * (src/lib/apple/app-site-association.ts).
 *
 * Apple's CDN fetches this over HTTPS, without following redirects, and
 * expects JSON: a 200 with `application/json`, at this exact path, on the host
 * the app names (www). Nothing here is secret.
 *
 * APPLE_APP_ID holds the app's `TEAMID.net.brokersconnect.app` (several,
 * comma-separated, for a development build beside the store one). Until it is
 * set there is no file — a 404 — rather than a file naming no app, which
 * Apple would cache and act on.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const appIds = parseAppIds(process.env.APPLE_APP_ID);
  if (!appIds.length) return new NextResponse(null, { status: 404 });

  return NextResponse.json(appSiteAssociation(appIds), {
    headers: {
      // Apple's CDN caches it anyway; an hour here keeps the edge from asking
      // the function on every request, and a change still lands the same day.
      'cache-control': 'public, max-age=3600',
    },
  });
}
