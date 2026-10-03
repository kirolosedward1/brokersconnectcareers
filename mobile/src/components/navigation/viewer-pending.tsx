import { ErrorState, LoadingState } from '~/components/ui/states';
import { useSession } from '~/lib/session';

/**
 * What a screen that needs the signed-in person's profile shows until it has
 * it: the wait — or, when the profile could not be read (offline, the service
 * down), the error and a way to try again, never a spinner that does not end.
 */
export function ViewerPending() {
  const { viewer, viewerError, refreshViewer } = useSession();
  if (viewer?.profileUnreadable) return <ErrorState error={viewerError} onRetry={() => refreshViewer().catch(() => {})} />;
  return <LoadingState />;
}
