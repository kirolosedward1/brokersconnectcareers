import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { createTranslator } from 'use-intl';
import { EMPTY_FILTERS } from '@/lib/job-filters';
import type { JobListItem } from '@/lib/job-list';
import type { AgentProfileRow, DistrictRow } from '@/lib/supabase/database.types';
import { shownToast, toast } from '~/components/feedback/toast';
import { badgeText } from '~/components/navigation/tab-bar';
import { fewerLast, resetFewerForTests } from '~/features/jobs/fewer';
import { countNewSince, instant, resetBoardSeenForTests, seenDividerBefore } from '~/features/jobs/new-since';
import { useJobBoard } from '~/features/jobs/queries';
import { suggestionsFor, withSuggestion, type SearchSuggestion } from '~/features/jobs/suggestions';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { markupTags } from '~/i18n/rich';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import { palette } from '~/theme/tokens';
import TabsLayout from '../src/app/(tabs)/_layout';
import * as HiddenScreen from '../src/app/(tabs)/(account)/account/hidden';
import * as HomeScreen from '../src/app/(tabs)/(home)/index';
import * as SharedLayout from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { board, browse, cairo, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  Finding things on the board: what the filter sheet suggests as the words
  are typed, and what each suggestion does; the line between what is new
  since the reader last looked and what was there before, and the count of
  the new ones on the Jobs tab; and "Show fewer like this", which moves a
  kind of listing to the end of Home's suggestions without hiding anything.
  Against stand-ins for Supabase and the website, through the real screens.
*/

jest.mock('~/lib/session-storage', () => {
  const store = new Map<string, string>();
  return {
    encryptedSessionStorage: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    },
  };
});

const ar = catalogues.ar;
const t = createTranslator({ locale: 'ar', messages: catalogues.ar });
const server = fakeServer();
const user = authUser();
const SHARED = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)';

const october: DistrictRow = { id: 12, governorate_id: 2, name_ar: 'السادس من أكتوبر', name_en: '6th of October', slug: '6th-of-october' };
const zayed: DistrictRow = { id: 13, governorate_id: 2, name_ar: 'الشيخ زايد', name_en: 'Sheikh Zayed', slug: 'sheikh-zayed' };

const HOUR = 60 * 60 * 1000;
/** A listing like the fixture's, published `hoursAgo` hours ago. */
function posted(id: string, title: string, hoursAgo: number, extra: Partial<JobListItem> = {}): JobListItem {
  return {
    ...listing,
    id: `5b0c7d1e-0000-4000-8000-00000000${id.padStart(4, '0')}`,
    slug: `job-${id}`,
    title_ar: title,
    published_at: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
    ...extra,
  };
}

const warnings: string[] = [];
beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  // No message may fail to format: the provider reports each one here.
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
  warnings.length = 0;
  toast.hide();
});

beforeEach(async () => {
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/districts', [newCairo, october, zayed]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/rest/v1/search_aliases', [{ alias: 'Tagamoa', district_id: newCairo.id, track: null }]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board());
  server.on('GET /rest/v1/applications', []);
  server.on('GET /rest/v1/saved_jobs', []);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  resetBoardSeenForTests();
  resetFewerForTests();
  server.requests.length = 0;
});

/** A returning candidate: signed in, and remembered by the phone. */
async function signedIn() {
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'correct-horse' });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null });
  server.requests.length = 0;
}

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

function Root() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Settled>
              <Stack screenOptions={{ headerShown: false }} />
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function stand(label: string) {
  function Screen() {
    return <Text>{label}</Text>;
  }
  return Screen;
}

/** Home, as far as the badge is concerned: it reads the whole board, as both of the real ones do. */
function HomeReadingTheBoard() {
  const read = useJobBoard('');
  return <Text>{read.data ? 'home: board read' : 'home'}</Text>;
}

/** The board alone, in a Jobs tab of its own. */
const boardApp = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(jobs)/jobs/index': BoardScreen,
  '(tabs)/(jobs)/jobs/[slug]': stand('the listing'),
};

/** The app's own tabs and tab bar, with Home reading the board. */
const tabsApp = (home: () => ReactNode = HomeReadingTheBoard) => ({
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': TabsLayout,
  [`${SHARED}/_layout`]: SharedLayout,
  '(tabs)/(home)/index': home,
  '(tabs)/(jobs)/jobs/index': BoardScreen,
  [`${SHARED}/jobs/[slug]`]: stand('the listing'),
  [`${SHARED}/companies/index`]: stand('the companies'),
  '(tabs)/(account)/account/index': stand('the account'),
});

/** The board's reads since `index`, as their parameters. */
const boardReads = () => server.asked('/api/mobile/v1/jobs').map((request) => request.url.searchParams);

describe('suggestions as the reader types', () => {
  const titled = posted('31', 'مُستشار مَبيعات', 1, { title_en: 'Sales consultant' });
  const sources = { locale: 'ar', districts: [newCairo, october, zayed], aliases: [], listings: [listing, titled] };
  const marked = (suggestion: SearchSuggestion) => suggestion.matched.slice(suggestion.span.start, suggestion.span.end);
  const said = (suggestions: SearchSuggestion[]) => suggestions.map((suggestion) => [suggestion.kind, suggestion.label, marked(suggestion)]);

  it("reads Arabic the website's way: any alef, a final ه for ة, no harakat, Arabic-Indic digits", () => {
    // No hamza typed on the alef: the place is found, and marked in its name as written.
    expect(said(suggestionsFor('اكتوبر', sources))).toEqual([['district', october.name_ar, 'أكتوبر']]);
    expect(said(suggestionsFor('القاهره', sources))).toEqual([['district', newCairo.name_ar, 'القاهرة']]);
    // Typed bare, found with its harakat — which are marked with the letters they sit on.
    expect(said(suggestionsFor('مستشار', sources))).toEqual([['title', titled.title_ar, 'مُستشار']]);
    // «٦» is 6: found in the place's other name, shown beneath its own.
    const sixth = suggestionsFor('٦th', sources);
    expect(sixth).toEqual([expect.objectContaining({ kind: 'district', slug: october.slug, label: october.name_ar, matched: october.name_en })]);
    expect(marked(sixth[0])).toBe('6th');
  });

  it('finds a place by its English name, or by another name people search it by', () => {
    expect(suggestionsFor('sheikh', sources)).toEqual([expect.objectContaining({ kind: 'district', slug: zayed.slug, matched: 'Sheikh Zayed' })]);
    const tagamoa = suggestionsFor('tagam', { ...sources, aliases: [{ alias: 'Tagamoa', district_id: newCairo.id, track: null }] });
    expect(tagamoa).toEqual([expect.objectContaining({ kind: 'district', slug: newCairo.slug, label: newCairo.name_ar, matched: 'Tagamoa' })]);
  });

  it('lists the places and tracks first, a name starting with the words before one that has them inside', () => {
    expect(said(suggestionsFor('بيع', sources))).toEqual([
      ['track', ar.track.primary, 'بيع'],
      ['track', ar.track.resale, 'بيع'],
      // «مبيعات»: the words inside a word, after the names that start with them; the shorter name first.
      ['title', titled.title_ar, 'بيع'],
      ['title', listing.title_ar, 'بيع'],
    ]);
    // A company by its name in either language, once however many listings it has.
    expect(said(suggestionsFor('nile', sources))).toEqual([['company', 'Nile Brokers', 'Nile']]);
  });

  it('waits for two letters, and offers six at most', () => {
    expect(suggestionsFor('ب', sources)).toEqual([]);
    expect(suggestionsFor(' ق ', sources)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, index) => posted(String(40 + index), `مندوب مبيعات ${index + 1}`, 2));
    expect(suggestionsFor('مندوب', { ...sources, listings: many })).toHaveLength(6);
  });

  it('turns an area or a track into its filter, letting the words go, and a title into the words', () => {
    const filters = { ...EMPTY_FILTERS, q: 'القاهره', tracks: ['resale' as const] };
    const [area] = suggestionsFor('القاهره', sources);
    expect(withSuggestion(filters, area)).toEqual({ ...filters, q: '', districtSlugs: [newCairo.slug] });
    const [track] = suggestionsFor('بيع أول', sources);
    expect(withSuggestion(filters, track)).toEqual({ ...filters, q: '', tracks: ['resale', 'primary'] });
    const [title] = suggestionsFor('مستشار', sources);
    expect(withSuggestion(filters, title)).toEqual({ ...filters, q: titled.title_ar });
  });

  describe('in the filter sheet', () => {
    async function typeInSheet(words: string) {
      renderRouter(boardApp, { initialUrl: '/jobs' });
      // The board's listings are what titles and companies are suggested from.
      expect(await screen.findByText(listing.title_ar)).toBeTruthy();
      fireEvent.press(screen.getByRole('button', { name: ar.jobs.filters }));
      fireEvent.changeText(await screen.findByLabelText(ar.filters.search), words);
    }

    it('marks the letters typed in the name, in the brand colour, inside its one line of text', async () => {
      await typeInSheet('القاهره');
      const area = await screen.findByRole('button', { name: t('app.jobs.suggestArea', { name: newCairo.name_ar }) });
      const mark = within(area).getByText('القاهرة');
      expect(StyleSheet.flatten(mark.props.style)).toMatchObject({ color: palette.light.primary, backgroundColor: palette.light.secondary });
      // Nested in the name's own text, which reads whole: the letters either side stay joined.
      expect(within(area).getByText(newCairo.name_ar)).toBeTruthy();
      expect(within(area).getByText(ar.app.jobs.suggestKindArea)).toBeTruthy();
    });

    it.each([
      ['القاهره', t('app.jobs.suggestArea', { name: newCairo.name_ar }), { district: newCairo.slug }],
      ['tagam', t('app.jobs.suggestArea', { name: newCairo.name_ar }), { district: newCairo.slug }],
      ['بيع أول', t('app.jobs.suggestTrack', { name: ar.track.primary }), { track: 'primary' }],
      ['مبيعات', t('app.jobs.suggestWords', { words: listing.title_ar }), { q: listing.title_ar }],
      ['نايل', t('app.jobs.suggestWords', { words: listing.company.name_ar }), { q: listing.company.name_ar }],
    ])('typed «%s», "%s" shows the board for it at once', async (words, name, expected) => {
      await typeInSheet(words);
      const suggestion = await screen.findByRole('button', { name });
      server.requests.length = 0;
      fireEvent.press(suggestion);

      await waitFor(() =>
        expect(
          boardReads().some((params) => Object.entries(expected).every(([key, value]) => params.get(key) === value) && ('q' in expected || !params.has('q'))),
        ).toBe(true),
      );
      // The sheet has gone with it.
      await waitFor(() => expect(screen.queryByLabelText(ar.filters.search)).toBeNull());
    });

    it('offers the recent searches again once the words are cleared', async () => {
      await typeInSheet('القاهره');
      expect(await screen.findByRole('button', { name: t('app.jobs.suggestArea', { name: newCairo.name_ar }) })).toBeTruthy();
      fireEvent.changeText(screen.getByLabelText(ar.filters.search), '');
      expect(screen.queryByRole('button', { name: t('app.jobs.suggestArea', { name: newCairo.name_ar }) })).toBeNull();
    });
  });
});

describe('new since the last visit', () => {
  const featuredOld = posted('51', 'إعلان مميز قديم', 30, { is_featured: true });
  const fresh1 = posted('52', 'وظيفة جديدة أولى', 0.2);
  const fresh2 = posted('53', 'وظيفة جديدة تانية', 0.4);
  const older1 = posted('54', 'وظيفة قديمة أولى', 2);
  const older2 = posted('55', 'وظيفة قديمة تانية', 3);
  const lastLook = older1.published_at;

  it('goes above the first listing from before, past sponsored ones and the ones applied to', () => {
    const none = new Set<string>();
    expect(seenDividerBefore([featuredOld, fresh1, fresh2, older1, older2], lastLook, none)).toBe(older1.id);
    // Nothing new: no line. Only new ones read so far: none yet.
    expect(seenDividerBefore([featuredOld, older1, older2], older1.published_at, none)).toBeNull();
    expect(seenDividerBefore([fresh1, fresh2], lastLook, none)).toBeNull();
    // A new sponsored listing on top is new.
    expect(seenDividerBefore([{ ...featuredOld, published_at: fresh1.published_at }, older1], lastLook, none)).toBe(older1.id);
    // Applied to: at the foot under its own heading, not where the old ones start.
    expect(seenDividerBefore([fresh1, older1, older2], lastLook, new Set([older1.id]))).toBe(older2.id);
    // Never opened before: nothing to say.
    expect(seenDividerBefore([fresh1, older1], null, none)).toBeNull();
  });

  it("counts what was published after, on the server's clock, in either of its spellings", () => {
    expect(countNewSince([fresh1, fresh2, older1, older2], lastLook)).toBe(2);
    expect(countNewSince([fresh1, older1], null)).toBe(0);
    expect(instant('2026-10-09 10:00:00.123+00')).toBe(Date.parse('2026-10-09T10:00:00.123Z'));
  });

  it('says a count up to nine on the tab, and "9+" past it', () => {
    expect(badgeText(3, 'ar')).toBe('3');
    expect(badgeText(9, 'ar')).toBe('9');
    expect(badgeText(12, 'ar')).toBe('9+');
    expect(badgeText(0, 'ar')).toBeNull();
    expect(badgeText(undefined, 'ar')).toBeNull();
  });

  it('draws a line under what is new since the last look and counts it on the Jobs tab until the board is opened', async () => {
    let jobs = [older1, older2];
    server.on('/api/mobile/v1/jobs', () => board(jobs));
    renderRouter(tabsApp(), { initialUrl: '/jobs' });

    // The first look: nothing to compare with, so no line.
    expect(await screen.findByText(older1.title_ar)).toBeTruthy();
    expect(screen.queryByText(ar.app.jobs.seenDivider)).toBeNull();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('bc.board-seen.v1:anon')) ?? '[]')).toEqual([{ at: older1.published_at }]));

    // Two listings published since; Home reads the board again.
    jobs = [fresh1, fresh2, older1, older2];
    fireEvent.press(screen.getByRole('tab', { name: ar.app.tabs.home }));
    expect(await screen.findByText('home: board read')).toBeTruthy();
    const labelled = t.markup('app.tabs.jobsNew', { name: ar.nav.jobs, count: 2, ...markupTags });
    const tab = await screen.findByRole('tab', { name: labelled });
    expect(within(tab).getByTestId('tab-badge')).toBeTruthy();
    expect(within(tab).getByText('2')).toBeTruthy();

    // Opened: the new ones above the line, the ones from before under it.
    fireEvent.press(tab);
    expect(await screen.findByText(ar.app.jobs.seenDivider)).toBeTruthy();
    expect(screen.getByRole('header', { name: ar.app.jobs.seenDivider })).toBeTruthy();
    const order = screen
      .getAllByText(new RegExp(`^(${[fresh1, fresh2, older1, older2].map((job) => job.title_ar).join('|')}|${ar.app.jobs.seenDivider})$`))
      .map((node) => node.props.children);
    expect(order).toEqual([fresh1.title_ar, fresh2.title_ar, ar.app.jobs.seenDivider, older1.title_ar, older2.title_ar]);
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('bc.board-seen.v1:anon')) ?? '[]')).toEqual([{ at: fresh1.published_at }]));

    // Into a listing and back: the same visit, the line where it was.
    fireEvent.press(screen.getByRole('link', { name: new RegExp(`^${fresh1.title_ar}`) }));
    expect(await screen.findByText('the listing')).toBeTruthy();
    act(() => router.back());
    expect(await screen.findByText(ar.app.jobs.seenDivider)).toBeTruthy();

    // Seen: back on Home, with the same board read again, the count is gone.
    fireEvent.press(screen.getByRole('tab', { name: ar.app.tabs.home }));
    expect(await screen.findByText('home: board read')).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByTestId('tab-badge')).toBeNull();
    expect(screen.getByRole('tab', { name: ar.nav.jobs })).toBeTruthy();

    // The next visit: nothing has been published since the last one, so no line.
    fireEvent.press(screen.getByRole('tab', { name: ar.nav.jobs }));
    await waitFor(() => expect(screen.queryByText(ar.app.jobs.seenDivider)).toBeNull());
    expect(screen.getByText(fresh1.title_ar)).toBeTruthy();
  });

  it('keeps the line where it was while the filters change and come off again, in one visit', async () => {
    await AsyncStorage.setItem('bc.board-seen.v1:anon', JSON.stringify([{ at: lastLook }]));
    server.on('/api/mobile/v1/jobs', () => board([fresh1, older1]));
    renderRouter(tabsApp(), { initialUrl: '/jobs' });
    expect(await screen.findByText(ar.app.jobs.seenDivider)).toBeTruthy();
    // Seen, on the whole board: written for the next visit…
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('bc.board-seen.v1:anon')) ?? '[]')).toEqual([{ at: fresh1.published_at }]));

    // …while this one keeps its own starting point, narrowed and widened again.
    act(() => router.setParams({ track: 'primary' }));
    await waitFor(() => expect(boardReads().some((params) => params.get('track') === 'primary')).toBe(true));
    expect(await screen.findByText(ar.app.jobs.seenDivider)).toBeTruthy();
    act(() => router.setParams({ track: undefined }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(await screen.findByText(ar.app.jobs.seenDivider)).toBeTruthy();
  });

  it('keeps the count off the tab that is open', async () => {
    await AsyncStorage.setItem('bc.board-seen.v1:anon', JSON.stringify([{ at: lastLook }]));
    server.on('/api/mobile/v1/jobs', () => board([fresh1, older1]));
    // A narrowed board marks nothing seen (below), so the count stands — but not on the Jobs tab while it is open.
    renderRouter(tabsApp(), { initialUrl: '/jobs?track=primary' });
    expect(await screen.findByText(fresh1.title_ar)).toBeTruthy();
    expect(screen.queryByTestId('tab-badge')).toBeNull();
    expect(screen.getByRole('tab', { name: ar.nav.jobs })).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: ar.app.tabs.home }));
    const tab = await screen.findByRole('tab', { name: t.markup('app.tabs.jobsNew', { name: ar.nav.jobs, count: 1, ...markupTags }) });
    expect(within(tab).getByText('1')).toBeTruthy();
  });

  it('marks nothing as seen from a board narrowed to a track, though it draws the line there too', async () => {
    await AsyncStorage.setItem('bc.board-seen.v1:anon', JSON.stringify([{ at: lastLook }]));
    server.on('/api/mobile/v1/jobs', () => board([fresh1, older1]));
    renderRouter(tabsApp(), { initialUrl: '/jobs?track=primary' });

    // Newest first, the line is true of a narrowed board as well…
    expect(await screen.findByText(ar.app.jobs.seenDivider)).toBeTruthy();
    // …but the listings in the other tracks have not been in front of the reader: nothing is marked seen.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(JSON.parse((await AsyncStorage.getItem('bc.board-seen.v1:anon')) ?? '[]')).toEqual([{ at: lastLook }]);
  });

  it('never asks the server for the count, and says nothing on a first launch', async () => {
    renderRouter(tabsApp(stand('home')), { initialUrl: '/' });
    expect(await screen.findByText('home')).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(server.asked('/api/mobile/v1/jobs')).toHaveLength(0);
    expect(screen.queryByTestId('tab-badge')).toBeNull();
    expect(screen.getByRole('tab', { name: ar.nav.jobs })).toBeTruthy();
  });
});

describe('show fewer like this', () => {
  // Newest first: one on the candidate's own track and district, one elsewhere.
  const fitting = posted('61', 'استشاري مبيعات أولية', 1);
  const elsewhere = posted('62', 'مسؤول تأجير', 2, {
    track: 'resale',
    district_id: 99,
    district: { ...newCairo, id: 99, name_ar: 'المعادي', name_en: 'Maadi', slug: 'maadi' },
    experience_band: 'senior_5_plus',
  });
  const agent: AgentProfileRow = {
    id: '0a000000-0000-4000-8000-000000000001',
    user_id: USER_ID,
    slug: 'sara-a1b2',
    headline_ar: null,
    headline_en: null,
    years_experience: 2,
    tracks: ['primary'],
    district_ids: [newCairo.id],
    languages: ['ar'],
    cv_path: null,
    availability: 'open_to_offers',
    visibility: 'verified_employers_only',
    summary_ar: null,
    summary_en: null,
    units_closed: null,
    volume_egp: null,
    restricted_at: null,
    restriction_reason: null,
    created_at: '2026-09-01T10:00:00Z',
  };
  const kindName = `${ar.track.primary} · ${newCairo.name_ar}`;
  const stored = async () => JSON.parse((await AsyncStorage.getItem(`bc.fewer-like-this.v1:${USER_ID}`)) ?? '[]');

  it('puts the kinds set aside after every other, each part in its own order', () => {
    const ranked = [fitting, posted('63', 'استشاري تاني', 3), elsewhere].map((job) => ({ job }));
    const keys = new Set([`primary:${newCairo.id}`]);
    expect(fewerLast(ranked, keys).map(({ job }) => job.title_ar)).toEqual([elsewhere.title_ar, fitting.title_ar, 'استشاري تاني']);
    expect(fewerLast(ranked, new Set()).map(({ job }) => job.id)).toEqual(ranked.map(({ job }) => job.id));
  });

  const homeApp = {
    _layout: Root,
    '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
    '(tabs)/(home)/index': HomeScreen,
    '(tabs)/(jobs)/jobs/index': stand('the board'),
    '(tabs)/(account)/account/hidden': HiddenScreen,
  };

  /** The suggested roles, in order — once the held card's menu, which names it too, has gone. */
  const suggested = () => screen.queryAllByText(new RegExp(`^(${fitting.title_ar}|${elsewhere.title_ar})$`)).map((node) => node.props.children);

  it("moves a kind to the end of Home's suggestions, with Undo, and keeps it for this person", async () => {
    server.on('/api/mobile/v1/jobs', board([fitting, elsewhere]));
    server.on('POST /rest/v1/rpc/candidate_summary', { applications_total: 0, applications_new: 0, applications_moved: 0, applications_hired: 0, replies: 0, saved_jobs: 0, saved_searches: 0, alerts_on: 0, profile_completeness: 80, has_profile: true, profile_views_30d: 0, open_jobs: 2 });
    server.on('GET /rest/v1/agent_profiles', [agent]);
    server.on('GET /rest/v1/agent_developers', []);
    await signedIn();
    renderRouter(homeApp, { initialUrl: '/' });

    expect(await screen.findByText(ar.dashboard.matchedRoles)).toBeTruthy();
    expect(suggested()).toEqual([fitting.title_ar, elsewhere.title_ar]);

    fireEvent(await screen.findByRole('link', { name: new RegExp(`^${fitting.title_ar}`) }), 'longPress');
    fireEvent.press(await screen.findByRole('menuitem', { name: ar.app.jobMenu.fewer }));

    // Done once the menu has gone: last among the suggestions, still there, and a way back.
    await waitFor(() => expect(shownToast()?.message).toBe(ar.app.toast.fewer));
    await waitFor(() => expect(suggested()).toEqual([elsewhere.title_ar, fitting.title_ar]));
    expect(await stored()).toEqual([{ track: 'primary', districtId: newCairo.id, district: { name_ar: newCairo.name_ar, name_en: newCairo.name_en } }]);

    act(() => shownToast()?.action?.onPress());
    await waitFor(() => expect(suggested()).toEqual([fitting.title_ar, elsewhere.title_ar]));
    expect(await stored()).toEqual([]);

    // Set aside already, the menu offers the way back instead.
    fireEvent(await screen.findByRole('link', { name: new RegExp(`^${fitting.title_ar}`) }), 'longPress');
    fireEvent.press(await screen.findByRole('menuitem', { name: ar.app.jobMenu.fewer }));
    await waitFor(() => expect(suggested()).toEqual([elsewhere.title_ar, fitting.title_ar]));
    fireEvent(await screen.findByRole('link', { name: new RegExp(`^${fitting.title_ar}`) }), 'longPress');
    expect(await screen.findByRole('menuitem', { name: ar.app.jobMenu.fewerOff })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: ar.app.jobMenu.fewer })).toBeNull();
    fireEvent.press(screen.getByRole('menuitem', { name: ar.app.jobMenu.fewerOff }));
    await waitFor(() => expect(shownToast()?.message).toBe(ar.app.toast.fewerOff));
    await waitFor(() => expect(suggested()).toEqual([fitting.title_ar, elsewhere.title_ar]));
  });

  it('lists the kinds in Account → Hidden on this phone, each a tap from showing as usual', async () => {
    await AsyncStorage.setItem(
      `bc.fewer-like-this.v1:${USER_ID}`,
      JSON.stringify([{ track: 'primary', districtId: newCairo.id, district: { name_ar: newCairo.name_ar, name_en: newCairo.name_en } }]),
    );
    await signedIn();
    renderRouter(homeApp, { initialUrl: '/account/hidden' });

    expect(await screen.findByRole('header', { name: ar.app.moderation.fewerHeading })).toBeTruthy();
    expect(screen.getByText(ar.app.moderation.fewerNote)).toBeTruthy();
    expect(screen.getByText(kindName)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: t('app.moderation.showAgainNamed', { name: kindName }) }));

    expect(await screen.findByText(ar.app.moderation.hiddenNothing)).toBeTruthy();
    expect(await stored()).toEqual([]);
  });

  it('is offered only to a candidate: nobody else has a Home it would change', async () => {
    server.on('/api/mobile/v1/jobs', board([fitting]));
    renderRouter(boardApp, { initialUrl: '/jobs' });
    fireEvent(await screen.findByRole('link', { name: new RegExp(`^${fitting.title_ar}`) }), 'longPress');
    expect(await screen.findByRole('menuitem', { name: ar.app.jobMenu.share })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: ar.app.jobMenu.fewer })).toBeNull();
  });

  it('leaves the board as it is', async () => {
    server.on('/api/mobile/v1/jobs', board([fitting]));
    const card = () => screen.findByRole('link', { name: new RegExp(`^${fitting.title_ar}`) });
    await signedIn();
    renderRouter(boardApp, { initialUrl: '/jobs' });
    fireEvent(await card(), 'longPress');
    fireEvent.press(await screen.findByRole('menuitem', { name: ar.app.jobMenu.fewer }));
    await waitFor(() => expect(shownToast()?.message).toBe(ar.app.toast.fewer));
    // Still on the board, and the board not asked again with anything left out.
    expect(await card()).toBeTruthy();
    expect(boardReads().every((params) => !params.has('track') && !params.has('district'))).toBe(true);
  });
});
