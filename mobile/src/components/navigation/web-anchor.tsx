import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useNavigationContainerRef, useRootNavigationState } from 'expo-router';
import { withoutLeakedParams } from '~/lib/leaked-params';

/**
 * On the web, a direct listing URL leaves the listing's slug on the screen
 * Back returns to. Drop it once the navigator has that stack, so Back is the
 * board (or the console) and not `?slug=`.
 */
export function WebAnchorParams() {
  const ref = useNavigationContainerRef();
  const ready = Boolean(useRootNavigationState()?.key);
  const done = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || !ready || done.current) return;
    const state = ref.getRootState();
    if (!state) return;
    done.current = true;
    const next = withoutLeakedParams(state);
    if (next === state) return;
    ref.reset(next);
  }, [ready, ref]);

  return null;
}
