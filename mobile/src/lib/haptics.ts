import * as Haptics from 'expo-haptics';

/**
 * The few taps the phone gives back, kept few: a click for choosing one of
 * several, a light tap for something kept or applied (a job saved, filters
 * applied), and a success for the moment that matters (an application sent).
 * iOS stays silent when its System Haptics setting is off, and a phone
 * without a Taptic Engine simply does nothing; nothing here can fail a press.
 */
export const haptic = {
  /** A light tap: something kept or applied (a job saved, filters applied). */
  tap() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  selection() {
    Haptics.selectionAsync().catch(() => {});
  },
  success() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
};
