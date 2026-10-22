import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '~/lib/session';

/**
 * Pull to refresh that spins for the pull, and only for the pull.
 *
 * Tied to a query's `isRefetching`, the spinner also ran whenever the data was
 * read again for some other reason — on the applicants' screens that is after
 * every move from a card — and on iOS a spinner that appears on its own pushes
 * the list down under the reader's finger.
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    refetch()
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };
  return { refreshing, onRefresh };
}

/**
 * Pull to refresh for a screen that reads several things — the account, its
 * settings: who is signed in, read again, and every query a screen on show
 * is following.
 */
export function useScreenRefresh() {
  const queryClient = useQueryClient();
  const { refreshViewer } = useSession();
  return usePullRefresh(() => Promise.all([refreshViewer(), queryClient.refetchQueries({ type: 'active' })]));
}
