import { useCallback } from 'react';
import { router, useNavigation } from 'expo-router';
import { StackActions } from 'expo-router/react-navigation';

/** The board, as the Jobs tab's stack names it. */
const BOARD = 'jobs/index';

/**
 * "To the board" from a screen deeper in a tab — the confirmation after
 * applying, a listing that has closed: back down to the board when it is
 * under this screen in this tab, as it was left (its filters, where it was
 * scrolled to); otherwise over to the Jobs tab. A plain navigate pushed a
 * second board on top, and Back from it led to the confirmation again.
 */
export function useToBoard() {
  const navigation = useNavigation();
  return useCallback(() => {
    const state = navigation.getState();
    const at = state ? state.routes.findIndex((route) => route.name === BOARD) : -1;
    if (state && at >= 0 && at < state.index) {
      navigation.dispatch(StackActions.pop(state.index - at));
      return;
    }
    router.navigate('/jobs');
  }, [navigation]);
}
