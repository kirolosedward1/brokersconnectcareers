import { useCallback, useEffect, useRef } from 'react';

type Paged = {
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

/**
 * A list's next page, for its end being reached — never while the list is
 * being read again. TanStack's fetchNextPage cancels a re-read in flight, so
 * the pages a cold start drew from the last run (or an hour-old list on
 * coming back to the app) stayed as they were, and the next page was counted
 * from them. Asked for during a re-read, the next page comes once it is in.
 */
export function useNextPage(query: Paged): () => void {
  const { hasNextPage, isFetching, isFetchingNextPage, fetchNextPage } = query;
  const wanted = useRef(false);

  useEffect(() => {
    if (!wanted.current || isFetching) return;
    wanted.current = false;
    if (hasNextPage) void fetchNextPage();
  }, [isFetching, hasNextPage, fetchNextPage]);

  return useCallback(() => {
    // The next page already on its way is the one asked for: not another after it.
    if (!hasNextPage || isFetchingNextPage) return;
    if (isFetching) wanted.current = true;
    else void fetchNextPage();
  }, [hasNextPage, isFetching, isFetchingNextPage, fetchNextPage]);
}
