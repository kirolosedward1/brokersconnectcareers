import { NextResponse } from 'next/server';
import { assetLinks, parseFingerprints } from '@/lib/android/asset-links';

/**
 * GET /.well-known/assetlinks.json — the Android app's claim to the site's
 * links (src/lib/android/asset-links.ts).
 *
 * Android fetches it over HTTPS when the app is installed, without following
 * redirects, and expects a 200 with `application/json`. Nothing here is
 * secret: a certificate fingerprint is public.
 *
 * ANDROID_CERT_SHA256 holds the signing certificate's SHA-256 fingerprint
 * (`AB:CD:…`, as `eas credentials` or the Play Console shows it; several,
 * comma-separated). Until it is set there is no file — a 404 — and links open
 * in the browser, as they do today.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const fingerprints = parseFingerprints(process.env.ANDROID_CERT_SHA256);
  if (!fingerprints.length) return new NextResponse(null, { status: 404 });

  return NextResponse.json(assetLinks(fingerprints), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
