import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { focusManager, QueryClient, type QueryKey } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistedClient, PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import * as Updates from 'expo-updates';
import { ApiError } from './api';

/**
 * Server state for the whole app.
 *
 * A 4xx is an answer, not a blip, so it is not retried; a network failure or a
 * 5xx is, twice.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
    },
  },
});

/**
 * Coming back to the app is the phone's "returning to the tab": whatever has
 * gone stale while it was in the background — the bell's count, the
 * applications — is read again, as the website re-reads a tab that has sat a
 * minute unseen.
 */
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
  return () => subscription.remove();
});

const DAY = 24 * 60 * 60 * 1000;

/**
 * The reads the app opens on, the same for every reader: Home's counts, the
 * unfiltered board and the unfiltered company directory, all three served
 * without a token and cached at the edge for everyone.
 */
const OPENING_READS: QueryKey[] = [['browse'], ['jobs', 'board', ''], ['companies', 'directory', '']];

export function isOpeningRead(key: QueryKey): boolean {
  return OPENING_READS.some((read) => read.length === key.length && read.every((part, index) => part === key[index]));
}

/**
 * A long list kept by its first page only: a board scrolled ten pages deep
 * is not ten pages to write on every change, and a cold start shows the top
 * of it anyway.
 */
export function firstPagesOnly(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => {
        const data = query.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined;
        if (!data || !Array.isArray(data.pages) || data.pages.length <= 1) return query;
        return { ...query, state: { ...query.state, data: { pages: data.pages.slice(0, 1), pageParams: (data.pageParams ?? []).slice(0, 1) } } };
      }),
    },
  };
}

/**
 * What survives a restart: the taxonomies (governorates, districts, developers)
 * and the opening reads above, and nothing about the person. A cold start
 * draws them at once, on a slow connection or none, and reads them again
 * behind them; the website keeps the taxonomies for a day, and so does the
 * app with all of these. A person's applications or notifications in plain
 * app storage would outlive a sign-out on a shared phone, so they are never
 * written here.
 *
 * Each build and each published update reads only what it wrote itself (the
 * buster is its update's id): an older one's lists may be another shape.
 */
export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister: createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'bc.query-cache.v1',
    serialize: (client) => JSON.stringify(firstPagesOnly(client)),
  }),
  maxAge: DAY,
  buster: `opening-reads-1:${Updates.updateId ?? 'none'}`,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && (query.queryKey[0] === 'taxonomy' || isOpeningRead(query.queryKey)),
  },
};
