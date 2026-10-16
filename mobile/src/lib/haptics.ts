import { useEffect } from 'react';
import * as Haptics from 'expo-haptics';

/**
 * The few taps the phone gives back, kept few: a click for choosing one of
 * several, a success for the moment that matters (an application sent), and
 * an error for a form that was refused — the words that say why are often
 * out of sight under the keyboard, and the button alone seemed to do nothing.
 * iOS stays silent when its System Haptics setting is off, and a phone
 * without a Taptic Engine simply does nothing; nothing here can fail a press.
 */
export const haptic = {
  selection() {
    Haptics.selectionAsync().catch(() => {});
  },
  success() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  error() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};

/**
 * The error tap for a form that shows its refusal in one message (sign-in,
 * the password and email forms): given each time the message appears or
 * changes to another, never while it only stays.
 */
export function useErrorFeedback(error: unknown) {
  useEffect(() => {
    if (error) haptic.error();
  }, [error]);
}
