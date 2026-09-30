import { activeLocales, defaultLocale } from '@/lib/locale';

/**
 * The file iOS reads to decide which links to www.brokersconnect.net open in
 * the app rather than in Safari (applinks), and which saved passwords the app
 * may offer (webcredentials).
 *
 * The app's screens mirror the website's paths, so the paths here are the
 * sections the app has screens for. Order matters — iOS takes the first
 * component that matches — so what must stay on the web comes first: the
 * code-flow callback (the browser holds its verifier), the API, unsubscribe
 * links (a one-tap page with nothing to open in an app) and the admin console.
 * Everything else about a link — its query, which listing — is the app's to
 * read (+native-intent.tsx).
 *
 * Pure. Served by src/app/.well-known/apple-app-site-association/route.ts.
 */

const STAY_ON_THE_WEB = ['/auth/callback*', '/api/*', '/unsubscribe*', '/admin', '/admin/*'];

/** The sections the app has screens for. Android names the same ones, as prefixes (mobile/app.config.ts). */
export const OPEN_IN_THE_APP = [
  '/jobs',
  '/jobs/*',
  '/companies',
  '/companies/*',
  '/agents',
  '/agents/*',
  '/notifications',
  '/dashboard',
  '/dashboard/*',
  '/employer',
  '/employer/*',
  // The token-hash email links: the app verifies them itself.
  '/auth/confirm*',
];

/** `TEAMID.bundle.id`, as Apple writes an app's identifier. */
const APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** The app identifiers in a comma-separated setting, the well-formed ones only. */
export function parseAppIds(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => APP_ID.test(id));
}

/** The same path under each published locale prefix (only Arabic, unprefixed, today). */
function localizedPaths(paths: string[]): string[] {
  return activeLocales.flatMap((locale) =>
    locale === defaultLocale ? paths : paths.map((path) => `/${locale}${path}`),
  );
}

export function appSiteAssociation(appIds: string[]) {
  return {
    applinks: {
      details: [
        {
          appIDs: appIds,
          components: [
            ...localizedPaths(STAY_ON_THE_WEB).map((path) => ({ '/': path, exclude: true })),
            ...localizedPaths(OPEN_IN_THE_APP).map((path) => ({ '/': path })),
          ],
        },
      ],
    },
    webcredentials: { apps: appIds },
  };
}
