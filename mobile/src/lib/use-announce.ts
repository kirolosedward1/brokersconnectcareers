import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Says `message` to VoiceOver as `when` turns true, and again if the message
 * changes while it holds. A live region (`accessibilityLiveRegion`) is
 * Android's alone: on iOS a status line that appears after a tap — "saved",
 * a count gone up — was never heard unless the reader happened to be on it.
 * Queued, so it waits for what VoiceOver is saying already (the button just
 * pressed) rather than cutting it off.
 */
export function useAnnounce(message: string | null | undefined, when: boolean = true) {
  const said = when && message ? message : null;
  useEffect(() => {
    if (said) AccessibilityInfo.announceForAccessibilityWithOptions(said, { queue: true });
  }, [said]);
}
