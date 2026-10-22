/**
 * Where the store buttons go. One place, read by every button on /app.
 *
 * TODO(owner): set APP_STORE_URL once the listing exists in App Store
 * Connect (docs/app-store.md, "After the listing exists"); it is the
 * `https://apps.apple.com/…/id…` link. Until then the button points at `#`
 * and stays on the page.
 *
 * GOOGLE_PLAY_URL stays null until the Android app ships: null is what
 * draws the Google Play badge muted, with "coming soon" on it.
 */
export const APP_STORE_URL: string | null = null;
export const GOOGLE_PLAY_URL: string | null = null;
