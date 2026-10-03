import * as Haptics from 'expo-haptics';

/**
 * The few taps the phone gives back, kept few: a click for choosing one of
 * several, and a success for the moment that matters (an application sent).
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
};
