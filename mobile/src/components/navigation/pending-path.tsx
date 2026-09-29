import { useEffect } from 'react';
import { router, useRootNavigationState, type Href } from 'expo-router';
import { routeInside } from '~/lib/links';
import { takePendingPath, usePendingPath } from '~/lib/open-path';
import { useSession } from '~/lib/session';

/**
 * Opens the page waiting in open-path.ts once who is signed in is known:
 * nobody, or an account whose profile has been read (or could not be, in
 * which case the last answer on this phone stands in). Beside the root stack,
 * so the tab bar has been drawn for that person before the page is opened —
 * and not before the navigator is there to open it.
 */
export function PendingPath() {
  const path = usePendingPath();
  const { ready, session, viewerLoading, actor } = useSession();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const known = ready && (!session || !viewerLoading);

  useEffect(() => {
    if (!path || !known || !navigationReady) return;
    const next = takePendingPath();
    if (next) router.navigate(routeInside(next, actor) as Href);
  }, [path, known, navigationReady, actor]);

  return null;
}
