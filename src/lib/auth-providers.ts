import 'server-only';
import { env } from '@/lib/env';

/**
 * Which sign-in providers the auth server will actually accept.
 *
 * The "continue with Google" button was rendered unconditionally and Google
 * was never enabled on the project, so every click got
 *
 *   {"code":400,"error_code":"validation_failed",
 *    "msg":"Unsupported provider: provider is not enabled"}
 *
 * on the first screen a new user meets — and it had a Google logo on it, which
 * made it the most trustworthy-looking control on the page.
 *
 * Asked, rather than kept in a second place. A NEXT_PUBLIC_GOOGLE_ENABLED flag
 * would be one more thing to remember on the day somebody turns the provider
 * on, and it would be wrong in exactly the situation it exists for. GoTrue
 * publishes /auth/v1/settings unauthenticated and it is the truth: enable
 * Google in the dashboard and the button appears within the cache window, with
 * no deploy.
 *
 * Failure closed. If the settings call does not answer, the button is hidden —
 * a missing button is a worse product than a working one, and a broken button
 * is worse than both.
 */
type GoTrueSettings = { external?: Record<string, boolean> };

export async function enabledProviders(): Promise<{ google: boolean }> {
  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: env.supabaseAnonKey },
      // Long enough that this is not a round trip per sign-in page view,
      // short enough that turning the provider on does not need a deploy.
      next: { revalidate: 300 },
    });

    if (!response.ok) return { google: false };

    const settings = (await response.json()) as GoTrueSettings;
    return { google: settings.external?.google === true };
  } catch {
    return { google: false };
  }
}
