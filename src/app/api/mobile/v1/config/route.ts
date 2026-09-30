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
 *   appStoreUrl       the app's App Store page, where "update the app" leads
 *                     (MOBILE_APP_STORE_URL); null until the app is listed.
 *   minAndroidAppVersion, playStoreUrl
 *                     the same two for Android, whose builds are numbered and
 *                     released apart (MOBILE_MIN_ANDROID_APP_VERSION, falling
 *                     back to the iPhone's; MOBILE_PLAY_STORE_URL).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = await enabledProviders();
  const minAppVersion = configuredValue(process.env.MOBILE_MIN_APP_VERSION) ?? '1.0.0';

  return NextResponse.json(
    {
      minAppVersion,
      turnstileSiteKey: configuredValue(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) ?? null,
      providers,
      englishEnabled: ENGLISH_ENABLED,
      billingEnabled: BILLING_ENABLED,
      supportEmail: configuredValue(env.supportEmail) ?? null,
      appStoreUrl: storeUrl(process.env.MOBILE_APP_STORE_URL, 'apps.apple.com'),
      minAndroidAppVersion: configuredValue(process.env.MOBILE_MIN_ANDROID_APP_VERSION) ?? minAppVersion,
      playStoreUrl: storeUrl(process.env.MOBILE_PLAY_STORE_URL, 'play.google.com'),
    } satisfies MobileConfig,
    { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  );
}

/** Only an https address on the store's own host: this is opened on people's phones. */
function storeUrl(raw: string | undefined, host: 'apps.apple.com' | 'play.google.com'): string | null {
  const value = configuredValue(raw);
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host ? url.toString() : null;
  } catch {
    return null;
  }
}
