import { I18nManager } from 'react-native';
import Constants from 'expo-constants';
import { defaultLocale, dirOf, ENGLISH_ENABLED, type Locale } from '@/lib/locale';

/**
 * The direction the app is laid out in.
 *
 * While English is unpublished the app is Arabic, so this is Arabic's
 * direction, taken from the locale when the module loads. It does not ask
 * `I18nManager`, and it does not read `extra.forcesRTL`.
 *
 * SDK 58 stopped turning iOS right to left from the phone's language when
 * `supportsRTL` is set. `I18nManager.isRTL` is then true only after
 * `forceRTL` — the expo-localization plugin writes that into the binary, and
 * it takes effect on the next process start — or when the phone's language
 * is one of the app's localizations (`CFBundleLocalizations` is `ar` and
 * `en`). Neither holds in Expo Go. Expo Go does not use this app's
 * Info.plist. It applies the manifest's `forcesRTL` after it has created
 * the screen (an update opened from the network, or a return from its own
 * home screen), and it resets an `I18nManager.forceRTL` call when its
 * launcher opens. `Updates.reloadAsync` after forcing does not stick there;
 * the app does not reload to correct direction.
 *
 * One value, so the layout and the glyphs that follow the reading cannot
 * disagree. The root layout sets it on its outermost view, the navigators'
 * headers and back gestures take it from LocaleDirContext, the tab bar is
 * given it, and every sheet, chevron and mirrored icon reads it. There is
 * no per-icon override.
 *
 * The day English is published, `forcesRTL` goes (app.config.ts) and a
 * language switch has to decide the direction. Until that switch exists,
 * the published app falls back to the manifest flag or `I18nManager`, which
 * is the same limit as before this was the locale's.
 */
export const appDirection: 'rtl' | 'ltr' = !ENGLISH_ENABLED
  ? dirOf(defaultLocale)
  : Constants.expoConfig?.extra?.forcesRTL === true || I18nManager.isRTL
    ? 'rtl'
    : 'ltr';

/**
 * The language the screens are drawn in.
 *
 * Text alignment follows this, not the direction the screen was created with.
 * Expo Go can come up left to right (above) while the app is still Arabic, so
 * Arabic is not "whatever I18nManager says". The catalogue's provider sets it
 * as it draws; until then it is the app's own language.
 */
let drawnLocale: Locale = defaultLocale;

export function setDrawnLocale(locale: Locale) {
  drawnLocale = locale;
}

export function drawnDirection(): 'rtl' | 'ltr' {
  return dirOf(drawnLocale);
}
