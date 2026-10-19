import { Alert, Platform, type AlertButton } from 'react-native';
import { getLocales } from 'expo-localization';
import { appDirection } from '~/lib/direction';

/**
 * The app's alerts and confirmations: iOS's own alert, asked exactly as
 * `Alert.alert` is, with its two buttons in the reading order of the app.
 *
 * iOS lays its alert out in its own language, and in Expo Go (or on an
 * iPhone set to English) that is left to right: "Cancel" stood on the left of
 * an Arabic question. Its buttons stand in the order they are given unless
 * one is marked `cancel`, which iOS always puts first (the left). So there,
 * Cancel is given last and unmarked: it stands on the right, where Arabic
 * reads first. On an iPhone that is itself right to left, iOS places it so.
 *
 * Not an alert the app draws: one drawn by the app is a sheet of its own,
 * which iOS will not present over another sheet or a modal screen. It never
 * showed there, and every alert after it waited behind it, so a form could
 * not be left and Withdraw or Sign out did nothing at all.
 */
export const dialog = {
  alert(...asked: Parameters<typeof Alert.alert>) {
    const [title, message, buttons, options] = asked;
    if (!buttons || buttons.length !== 2 || !mirrored()) {
      Alert.alert(...asked);
      return;
    }
    const arranged = readingOrder(buttons);
    if (options) Alert.alert(title, message, arranged, options);
    else Alert.alert(title, message, arranged);
  },
};

/**
 * The app reads right to left where iOS itself lays out left to right.
 *
 * iOS lays its alert out in the phone's own language, not in React Native's
 * direction: I18nManager.isRTL is true in Expo Go (it applies the manifest's
 * forcesRTL) while an English iPhone still drew "Cancel" on the left of
 * "اسحب الطلب". So the phone's language decides, as iOS does.
 */
export function mirrored(): boolean {
  return Platform.OS === 'ios' && appDirection === 'rtl' && systemDirection() !== 'rtl';
}

function systemDirection(): 'rtl' | 'ltr' {
  try {
    return getLocales()[0]?.textDirection === 'rtl' ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

/** Two buttons, Cancel on the right: the other first, Cancel last and unmarked. */
export function readingOrder(buttons: AlertButton[]): AlertButton[] {
  const cancel = buttons.filter((button) => button.style === 'cancel');
  const others = buttons.filter((button) => button.style !== 'cancel');
  return [...others, ...cancel.map((button) => ({ ...button, style: 'default' as const }))];
}
