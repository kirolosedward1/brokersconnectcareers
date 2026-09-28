import { NextResponse } from 'next/server';
import { enabledProviders } from '@/lib/auth-providers';
import { BILLING_ENABLED, configuredValue } from '@/lib/env';
import { ENGLISH_ENABLED } from '@/lib/locale';

/**
 * GET /api/mobile/v1/config — what the app needs to know before its first
 * screen, and nothing secret.
 *
 *   minAppVersion     below this the app shows "update required" instead of
 *                     calling an API that has moved on (MOBILE_MIN_APP_VERSION).
 *   turnstileSiteKey  set when Supabase Auth requires a CAPTCHA token for
 *                     password sign-in, sign-up and reset; null when it does not.
 *   providers         which one-tap sign-ins the auth server will accept today.
 *   englishEnabled    the website's switch; the app follows it.
 *   billingEnabled    the app never sells anything, but says what is free.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = await enabledProviders();

  return NextResponse.json(
    {
      minAppVersion: configuredValue(process.env.MOBILE_MIN_APP_VERSION) ?? '1.0.0',
      turnstileSiteKey: configuredValue(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) ?? null,
      providers,
      englishEnabled: ENGLISH_ENABLED,
      billingEnabled: BILLING_ENABLED,
    },
    { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
