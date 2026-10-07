import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { useIsFocused } from 'expo-router';

/**
 * Android's Back does nothing on a step that is finished, or left, by its own
 * buttons: the second factor's code and onboarding, each of which offers to
 * sign out. Back closed the screen, the session gate opened it again at once,
 * and what had been typed was gone.
 */
export function useHoldBack(): void {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [focused]);
}
