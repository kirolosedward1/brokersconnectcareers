import { I18nManager } from 'react-native';
import Constants from 'expo-constants';
import { defaultLocale, dirOf, type Locale } from '@/lib/locale';

/**
 * The direction the app is laid out in: right to left while it is Arabic only
 * (app.config.ts, `forcesRTL`), or when the phone's language asks for it.
 *
 * Given to every view and every native bar by the app itself, not left to
 * the direction React Native fixes when the screen is created. Expo Go
 * creates that screen before it applies the app's `forcesRTL` whenever it
 * opens an update from the network or comes back from its own home screen
 * (SDK 57's EXAppViewController), and lays native bars out in Expo Go's own
 * language: the app came up left to right, with its tab bar the wrong way
 * round, on the owner's iPhone. Starting the app again to correct it did not
 * correct it there.
 *
 * So the root layout lays everything out in this direction (`direction` on
 * its outermost view, which React Native's layout and its text alignment
 * follow), the navigators' headers and back gestures take it from the
 * navigation's own direction (LocaleDirContext), and the tab bar is given it
 * (src/app/(tabs)/_layout.tsx). A build of the app is created right to left
 * already; there the same values change nothing.
 */
export const appDirection: 'rtl' | 'ltr' =
  Constants.expoConfig?.extra?.forcesRTL === true || I18nManager.isRTL ? 'rtl' : 'ltr';

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
