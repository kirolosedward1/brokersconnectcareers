import { NextResponse } from 'next/server';
import { enabledProviders } from '@/lib/auth-providers';
import { BILLING_ENABLED, configuredValue, env } from '@/lib/env';
import { ENGLISH_ENABLED } from '@/lib/locale';
import type { MobileConfig } from '@/lib/mobile-api/reads';

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
 *   supportEmail      the contact address the website's footer shows, when
 *                     one is set — the app's "contact us" and the way out
 *                     of a deletion only the team can finish.
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
      supportEmail: configuredValue(env.supportEmail) ?? null,
    } satisfies MobileConfig,
    { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}
