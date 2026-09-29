/**
 * The three values the app is built with, and nothing secret.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` into the bundle at build time — only
 * when read by that exact name, which is why each is spelled out below. EAS
 * builds take them from eas.json; `expo start` from mobile/.env (copy
 * .env.example). The Supabase key is the publishable one the website also ships
 * to every browser: row-level security protects the data, not this key.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy mobile/.env.example to mobile/.env, or build with eas.json.`);
  }
  return value;
}

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  /** The website: /api/mobile/v1 is here, and so is everything opened in the in-app browser. */
  siteUrl: required('EXPO_PUBLIC_SITE_URL', process.env.EXPO_PUBLIC_SITE_URL).replace(/\/$/, ''),
} as const;
