import { Stack, Tabs } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { firstPagesOnly, isOpeningRead, persistOptions } from '~/lib/query';
import { SessionProvider } from '~/lib/session';
import { ThemeProvider } from '~/theme/provider';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import { board, browse, cairo, directory, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  A cold start draws what the app opens on at once — Home's counts, the
  unfiltered board, the unfiltered company directory — from what the last
  run kept, and reads it again behind it. On a slow first answer (the store
  smoke run once waited over 45 seconds for the board) the reader sees the
  board rather than placeholders. Nothing about the person is kept.
*/

const ar = catalogues.ar;
const server = fakeServer();

/** A cache with no clean-up timers left running once a test is done. */
const cache = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(() => {
  server.requests.length = 0;
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board());
});

/** A read held in flight until the test lets it go. */
function held<T>(answer: () => T) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { handler: async () => (await gate, answer()), release };
}

describe('what is kept for the next start', () => {
  it('the opening reads, by their exact keys', () => {
    expect(isOpeningRead(['browse'])).toBe(true);
    expect(isOpeningRead(['jobs', 'board', ''])).toBe(true);
    expect(isOpeningRead(['companies', 'directory', ''])).toBe(true);
    // A narrowed board is one search among many; a listing is read when opened.
    expect(isOpeningRead(['jobs', 'board', 'track=primary'])).toBe(false);
    expect(isOpeningRead(['jobs', 'detail', listing.slug])).toBe(false);
    expect(isOpeningRead(['jobs'])).toBe(false);
  });

  it('a long list by its first page', () => {
    const two = { pages: [board(), board()], pageParams: [1, 2] };
    const kept = firstPagesOnly({
      timestamp: 0,
      buster: '',
      clientState: { mutations: [], queries: [{ queryKey: ['jobs', 'board', ''], queryHash: 'h', dehydratedAt: 0, state: { data: two } as never }] },
    });
    expect(kept.clientState.queries[0].state.data).toEqual({ pages: [board()], pageParams: [1] });
  });

  it('survives a restart with the taxonomies, and nothing about the person', async () => {
    const client = cache();
    client.setQueryData(['taxonomy', 'districts'], [newCairo]);
    client.setQueryData(['browse'], browse);
    client.setQueryData(['jobs', 'board', ''], { pages: [board(), board()], pageParams: [1, 2] });
    client.setQueryData(['jobs', 'board', 'track=primary'], { pages: [board()], pageParams: [1] });
    client.setQueryData(['companies', 'directory', ''], { pages: [directory], pageParams: [1] });
    client.setQueryData(['applications', 'mine'], [{ id: 'a1' }]);
    client.setQueryData(['notifications', 'feed'], { pages: [[{ id: 'n1' }]], pageParams: [null] });
    client.setQueryData(['viewer'], { id: 'u1' });

    const { persister, buster, maxAge, dehydrateOptions } = persistOptions;
    await persistQueryClientSave({ queryClient: client, persister, buster, dehydrateOptions });
    const restarted = cache();
    await persistQueryClientRestore({ queryClient: restarted, persister, buster, maxAge });

    const kept = restarted
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey))
      .sort();
    expect(kept).toEqual(
      [['browse'], ['companies', 'directory', ''], ['jobs', 'board', ''], ['taxonomy', 'districts']].map((key) => JSON.stringify(key)).sort(),
    );
    expect(restarted.getQueryData(['jobs', 'board', ''])).toEqual({ pages: [board()], pageParams: [1] });
  });
});

describe('the board on a cold start', () => {
  function app(client: QueryClient) {
    function Root() {
      return (
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <I18nProvider>
              <SessionProvider>
                <Stack screenOptions={{ headerShown: false }} />
              </SessionProvider>
            </I18nProvider>
          </ThemeProvider>
        </QueryClientProvider>
      );
    }
    return {
      _layout: Root,
      '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
      '(tabs)/(home,jobs,companies)/_layout': TabStack,
      '(tabs)/(jobs)/jobs/index': BoardScreen,
    };
  }

  it('draws the kept listings at once, and reads them again behind them', async () => {
    const client = cache();
    // What the last run kept, a while ago.
    client.setQueryData(['jobs', 'board', ''], { pages: [board()], pageParams: [1] }, { updatedAt: Date.now() - 60 * 60 * 1000 });
    const reading = held(() => board());
    server.on('/api/mobile/v1/jobs', reading.handler);

    renderRouter(app(client), { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await waitFor(() => expect(server.asked('/api/mobile/v1/jobs').length).toBe(1));
    await act(async () => reading.release());
    expect(screen.getByText(listing.title_ar)).toBeTruthy();
  });

  it('offers its filters and its order while the first listings are on their way', async () => {
    const client = cache();
    const reading = held(() => board());
    server.on('/api/mobile/v1/jobs', reading.handler);

    renderRouter(app(client), { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByRole('progressbar')).toBeTruthy();
    expect(screen.getByText(ar.jobs.filters)).toBeTruthy();
    expect(screen.getByRole('radio', { name: ar.jobs.sortNewest }).props.accessibilityState).toMatchObject({ checked: true });
    // No count before there is one to give.
    expect(screen.queryByText('نتيجة واحدة')).toBeNull();

    await act(async () => reading.release());
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('نتيجة واحدة')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
