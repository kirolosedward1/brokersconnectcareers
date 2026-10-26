/**
 * The store listings. One place, read by the buttons on /app and by the
 * card on the job results.
 *
 * TODO(owner): set APP_STORE_URL once the listing exists in App Store
 * Connect (docs/app-store.md, "After the listing exists"); it is the
 * `https://apps.apple.com/…/id…` link. Until then the button on /app
 * points at `#` and stays on the page, and the results card says the
 * app is coming soon.
 *
 * GOOGLE_PLAY_URL stays null until the Android app ships. On /app that
 * draws the Google Play badge muted, with "coming soon" on it. On the
 * results card a null address draws no badge — a greyed badge is not a
 * listing.
 *
 * APP_SMART_LINK_PATH is the address a results-page QR will encode once
 * that drawing is added. It is not drawn yet. /api/app/open sends an
 * iPhone to the App Store and an Android phone to Google Play, when
 * that listing is the one set.
 */
export const APP_STORE_URL: string | null = null;
export const GOOGLE_PLAY_URL: string | null = null;

/** Where a phone is sent on to its own store. The results card does not draw a QR of this yet. */
export const APP_SMART_LINK_PATH = '/api/app/open';

/**
 * Below 1024px the results card is inserted after this many listings.
 * The side column, from 1024px, does not use it.
 */
export const APP_PROMO_INLINE_AFTER = 5;

export type StoreLinks = {
  appStore: string | null;
  play: string | null;
};

const STORE_HOST = {
  appStore: 'apps.apple.com',
  play: 'play.google.com',
} as const;

/**
 * An https address on the store's own host, or null.
 *
 * The same rule as the mobile config: a listing link is opened on
 * people's phones, so anything else is treated as unset.
 */
export function storeLink(raw: string | null | undefined, host: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === host ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The two listings, after the host check. Defaults to the constants above. */
export function resolvedStoreUrls(
  source: { appStore?: string | null; play?: string | null } = {
    appStore: APP_STORE_URL,
    play: GOOGLE_PLAY_URL,
  },
): StoreLinks {
  return {
    appStore: storeLink(source.appStore, STORE_HOST.appStore),
    play: storeLink(source.play, STORE_HOST.play),
  };
}

export type PhonePlatform = 'ios' | 'android' | 'other';

/**
 * Which store this browser can open.
 *
 * iPadOS 13 and later can send a Macintosh user-agent with no "Mobile"
 * in it, the same string as a Mac. That one is `other`: it cannot be
 * told from a laptop.
 */
export function phonePlatform(userAgent: string): PhonePlatform {
  if (/android/i.test(userAgent)) return 'android';
  if (/iPad|iPhone|iPod/i.test(userAgent)) return 'ios';
  if (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent)) return 'ios';
  return 'other';
}

/**
 * Where /api/app/open sends this visitor.
 *
 * The phone's own store when that listing is set. A desktop with one
 * listing goes there. Anything else — the other store is the only one
 * listed, both are, or neither is — goes to /app, which is where the
 * buttons for whatever is listed already live.
 */
export function storeRedirectTarget(
  userAgent: string,
  source?: { appStore?: string | null; play?: string | null },
): string {
  const { appStore, play } = resolvedStoreUrls(source);
  const platform = phonePlatform(userAgent);
  if (platform === 'ios' && appStore) return appStore;
  if (platform === 'android' && play) return play;
  if (platform === 'other' && appStore && !play) return appStore;
  if (platform === 'other' && play && !appStore) return play;
  return '/app';
}
