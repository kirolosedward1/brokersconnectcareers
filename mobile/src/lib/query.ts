import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
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

const DAY = 24 * 60 * 60 * 1000;

/**
 * What survives a restart: the taxonomies (governorates, districts, developers)
 * and nothing about the person. The website keeps the taxonomies for a day;
 * so does the app, so the filters draw instantly on a cold start. A person's
 * applications or notifications in plain app storage would outlive a sign-out
 * on a shared phone, so they are never written here.
 */
export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister: createAsyncStoragePersister({ storage: AsyncStorage, key: 'bc.query-cache.v1' }),
  maxAge: DAY,
  buster: 'taxonomy-v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.queryKey[0] === 'taxonomy' && query.state.status === 'success',
  },
};
