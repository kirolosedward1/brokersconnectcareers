import { router, Stack } from 'expo-router';
import { createTranslator } from 'use-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Modal, RefreshControl, type AlertButton } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { VerifiedExplainerHost } from '~/components/companies/verified-mark';
import { hideJob, unhideJob } from '~/features/moderation/hidden-jobs';
import { hideCompany, unhideCompany } from '~/features/moderation/hidden-companies';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { SessionProvider } from '~/lib/session';
import { ThemeProvider } from '~/theme/provider';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
import * as CompanyScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/companies/[slug]';
import * as JobScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/jobs/[slug]';
import * as HomeScreen from '../src/app/(tabs)/(home)/index';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import * as SearchScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/jobs/search';
import * as CompaniesScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/companies/index';
import * as HiddenScreen from '../src/app/(tabs)/(account)/account/hidden';
import * as NotFoundScreen from '../src/app/+not-found';
import { DeclaredTabs } from './declared-tabs';
import { board, browse, cairo, company, companyPage, directory, jobPage, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  The real screens, rendered against the website's API shapes: the home
  screen, the board, a listing, the directory and a company page, each drawn
  from fixtures through the same hooks and the same catalogue as on a phone.
  What this catches is everything a typecheck cannot — a provider missing, a
  message that fails to format, a parameter read under the wrong name.
*/

const ar = catalogues.ar;
const tAr = createTranslator({ locale: 'ar', messages: catalogues.ar });
// Read from the catalogue, so that renaming a track is a change of words, not of these tests.
const landingTitle = ar.landing.title.replace('{track}', ar.track.primary).replace('{district}', newCairo.name_ar);
const server = fakeServer();

const SPONSORED_FIRST = ar.jobs.sponsoredFirst;

const warnings: string[] = [];
beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

beforeEach(() => {
  warnings.length = 0;
  server.requests.length = 0;
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/api/mobile/v1/browse', browse);
  server.on('/api/mobile/v1/jobs', board());
  server.on(`/api/mobile/v1/jobs/${listing.slug}`, jobPage);
  server.on('/api/mobile/v1/companies', directory);
  server.on('/api/mobile/v1/companies/nile-brokers', companyPage);
  server.on('POST /api/mobile/v1/actions/recordJobView', { ok: true });
});

afterEach(() => {
  // No message may fail to format: the provider reports each one here.
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
});

/** Each test's query cache, for reading the board again as the app does on its own. */
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

function Root() {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <VerifiedExplainerHost />
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <DeclaredTabs routes={app} />,
  '(tabs)/(home,jobs,companies)/_layout': TabStack,
  '(tabs)/(home,jobs,companies)/jobs/search': SearchScreen,
  '(tabs)/(home,jobs,companies)/jobs/[slug]': JobScreen,
  '(tabs)/(home,jobs,companies)/companies/[slug]': CompanyScreen,
  '(tabs)/(home)/index': HomeScreen,
  '(tabs)/(jobs)/jobs/index': BoardScreen,
  '(tabs)/(companies)/companies/index': CompaniesScreen,
  '(tabs)/(account)/account/hidden': HiddenScreen,
  '+not-found': NotFoundScreen,
};

describe('home', () => {
  it('leads with the search, the ways in and the newest roles', async () => {
    await renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText('منصة متخصصة لوظائف العقارات في مصر')).toBeTruthy();
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    // The browse index, with the district's name from the taxonomy.
    expect(await screen.findByLabelText('القاهرة الجديدة، وظيفة واحدة')).toBeTruthy();
    expect(screen.getByText('وظائف شركات البروكر')).toBeTruthy();
  });

  it('says it has no connection on a first launch without one, and fills in once Retry is pressed', async () => {
    let online = false;
    const offline = () => {
      throw new TypeError('Network request failed');
    };
    server.on('/api/mobile/v1/jobs', () => (online ? board() : offline()));
    server.on('/api/mobile/v1/browse', () => (online ? browse : offline()));
    await renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.app.offline.title)).toBeTruthy();
    expect(screen.queryByText(listing.title_ar)).toBeNull();

    online = true;
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.queryByText(ar.app.offline.title)).toBeNull();
  });

  it('keeps the search above the keyboard on a small phone, as the other homes do', async () => {
    await renderRouter(app, { initialUrl: '/' });
    let node = (await screen.findByLabelText(ar.landingPage.hero.searchLabel)).parent;
    while (node && node.props.keyboardShouldPersistTaps === undefined) node = node.parent;
    expect(node?.props.automaticallyAdjustKeyboardInsets).toBe(true);
    // Dragged down with the page, the keyboard goes with the finger rather than all at once.
    expect(node?.props.keyboardDismissMode).toBe('interactive');
  });

  it('searches the board with the words typed', async () => {
    const result = await renderRouter(app, { initialUrl: '/' });
    fireEvent.changeText(await screen.findByLabelText('ابحث عن وظيفة'), 'مبيعات');
    fireEvent.press(screen.getByText('تصفّح الوظائف'));
    await waitFor(() => expect(result.getPathnameWithParams()).toBe('/jobs?q=%D9%85%D8%A8%D9%8A%D8%B9%D8%A7%D8%AA'));
  });
});

/** A read held in flight until the test lets it go. */
function held<T>(answer: () => T) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { handler: async () => (await gate, answer()), release };
}

describe('the board', () => {
  it('spins for a pull, and not when the board is read again on its own', async () => {
    await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    const spinning = () => screen.UNSAFE_getByType(RefreshControl).props.refreshing;
    expect(spinning()).toBe(false);

    // Read again on coming back to the app: no spinner pushing the list down.
    const reading = held(() => board());
    server.on('/api/mobile/v1/jobs', reading.handler);
    act(() => {
      void client.invalidateQueries({ queryKey: ['jobs', 'board'] });
    });
    await waitFor(() => expect(server.asked('/api/mobile/v1/jobs').length).toBeGreaterThan(1));
    expect(spinning()).toBe(false);
    await act(async () => reading.release());

    // A pull: the spinner, until the board is in.
    const again = held(() => board());
    server.on('/api/mobile/v1/jobs', again.handler);
    act(() => {
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(spinning()).toBe(true);
    await act(async () => again.release());
    await waitFor(() => expect(spinning()).toBe(false));
  });

  it('shows the listings, how many, and the basic salary with its currency', async () => {
    await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('نتيجة واحدة')).toBeTruthy();
    // The salary range as one left-to-right run, low to high, with ج.م a month beside it.
    expect(screen.getByText('⁦10,000 – 15,000⁩')).toBeTruthy();
    expect(screen.getByText(` ${ar.app.money.perMonth}`)).toBeTruthy();
    // Nothing sponsored on the page, so nothing to explain about the order.
    expect(screen.queryByText(SPONSORED_FIRST)).toBeNull();
  });

  it('says the board is the one kept from before, and how old it is, when there is no connection', async () => {
    await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    server.on('/api/mobile/v1/jobs', () => {
      throw new TypeError('Network request failed');
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['jobs', 'board'] });
    });
    expect(await screen.findByText('لا يوجد اتصال. تعرض آخر وظائف حُمّلت قبل دقيقة.')).toBeTruthy();
    // The listings stay.
    expect(screen.getByText(listing.title_ar)).toBeTruthy();
  });

  it('labels a sponsored listing, and says sponsored listings come first whatever the sort', async () => {
    server.on('/api/mobile/v1/jobs', board([{ ...listing, is_featured: true }]));
    await renderRouter(app, { initialUrl: '/(jobs)/jobs?sort=salary' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('إعلان ممول')).toBeTruthy();
    expect(screen.getByText(SPONSORED_FIRST)).toBeTruthy();
  });

  it('says nothing about sponsored listings when the only one is from a company the reader hid', async () => {
    const other = {
      ...listing,
      id: '5b0c7d1e-0000-4000-8000-000000000102',
      slug: 'sales-manager-c3d4',
      title_ar: 'مدير مبيعات',
      company_id: 'c0000000-0000-4000-8000-000000000002',
      company: { ...listing.company, id: 'c0000000-0000-4000-8000-000000000002', slug: 'other-brokers' },
    };
    server.on('/api/mobile/v1/jobs', board([{ ...listing, is_featured: true }, other]));
    act(() => hideCompany(company.id));
    try {
      await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
      expect(await screen.findByText(other.title_ar)).toBeTruthy();
      expect(screen.queryByText(listing.title_ar)).toBeNull();
      expect(screen.queryByText(SPONSORED_FIRST)).toBeNull();
    } finally {
      act(() => unhideCompany(company.id));
    }
  });

  it('tells VoiceOver everything a card shows: sponsored, closed, the pay and the rest, not only who and where', async () => {
    server.on('/api/mobile/v1/jobs', board([{ ...listing, is_featured: true, expires_at: new Date(Date.now() - 86_400_000).toISOString() }]));
    await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();

    const card = screen.getByRole('link', { name: new RegExp(`^${listing.title_ar}`) });
    const spoken = card.props.accessibilityLabel as string;
    for (const said of [
      'إعلان ممول',
      ar.jobs.closedShort,
      ar.companies.verified,
      `⁦10,000 – 15,000⁩ ${ar.app.money.perMonth}`,
      ar.leadsSource.company_provided_short,
      ar.track.primary,
      // Three seats: the card's chip is the seats rather than the experience asked.
      `3 ${tAr('jobs.seatsLabel', { count: 3 })}`,
    ]) {
      expect(spoken).toContain(said);
    }
  });

  it('says "no basic salary", not "commission only", for a listing that has no commission either', async () => {
    server.on(
      '/api/mobile/v1/jobs',
      board([{ ...listing, basic_salary_min: null, basic_salary_max: null, commission_type: 'none', commission_value: null }]),
    );
    await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText(ar.compensation.noBasicSalary)).toBeTruthy();
    expect(screen.queryByText(ar.compensation.commissionOnly)).toBeNull();
  });

  it('asks the server for exactly the filters in the address', async () => {
    await renderRouter(app, { initialUrl: '/(jobs)/jobs?district=new-cairo&track=primary' });
    await screen.findByText(listing.title_ar);
    const asked = server.asked('/api/mobile/v1/jobs').map((request) => request.url.search);
    expect(asked).toContain('?track=primary&district=new-cairo');
  });

  it('shows each filter as a chip that removes it', async () => {
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs?district=new-cairo&track=primary' });
    await screen.findByText(listing.title_ar);
    fireEvent.press(await screen.findByLabelText(ar.jobs.removeFilter.replace('{name}', 'القاهرة الجديدة')));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'primary' }));
  });

  it('has a search field over it, the same words as the filter sheet’s, searched with the Search key', async () => {
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs?track=primary' });
    await screen.findByText(listing.title_ar);
    // In sight at the top of the board, not only a tap into the sheet.
    const field = screen.getByLabelText(ar.app.jobs.searchLabel);
    expect(field.props.placeholder).toBe(ar.filters.searchPlaceholder);
    fireEvent.changeText(field, '  مدير مبيعات  ');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(result.getSearchParams()).toEqual({ q: 'مدير مبيعات', track: 'primary' }));
    // The field says what the board is searched by.
    await waitFor(() => expect(screen.getByLabelText(ar.app.jobs.searchLabel).props.value).toBe('مدير مبيعات'));
    // A chip like any filter's, which takes the words off again, and out of the field.
    fireEvent.press(await screen.findByLabelText(ar.jobs.removeFilter.replace('{name}', '«مدير مبيعات»')));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'primary' }));
    await waitFor(() => expect(screen.getByLabelText(ar.app.jobs.searchLabel).props.value).toBe(''));
  });

  it('still searches the words from the filter sheet, as on the website', async () => {
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs?track=primary' });
    await screen.findByText(listing.title_ar);
    fireEvent.press(screen.getByRole('button', { name: 'الفلاتر · 1' }));
    const sheet = within(screen.UNSAFE_getByType(Modal));
    const field = sheet.getByLabelText(ar.filters.search);
    fireEvent.changeText(field, '  مدير مبيعات  ');
    // Applied as typed, even with the keyboard still up.
    fireEvent.press(sheet.getByRole('button', { name: /عرض النتائج/ }));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ q: 'مدير مبيعات', track: 'primary' }));
  });

  it('offers the one filter to drop when nothing matches', async () => {
    server.on('/api/mobile/v1/jobs', board([], { relaxations: [{ key: 'district-new-cairo', count: 4 }] }));
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs?district=new-cairo&track=primary' });
    expect(await screen.findByText('لا توجد وظائف مطابقة لبحثك.')).toBeTruthy();
    // Named from the taxonomy, which arrives beside the board.
    fireEvent.press(await screen.findByText('بدون القاهرة الجديدة · 4 وظائف'));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'primary' }));
  });

  it('offers every filter the website has, counts what they come to, and applies them in one go', async () => {
    // A narrowed board answers with how many it would show.
    server.on('/api/mobile/v1/jobs', (url: URL) => board([listing], { total: url.searchParams.has('track') ? 7 : 1 }));
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs?q=%D9%85%D8%A8%D9%8A%D8%B9%D8%A7%D8%AA' });
    await screen.findByText(listing.title_ar);

    fireEvent.press(screen.getByRole('button', { name: 'الفلاتر · 1' }));
    // The sheet's own choices, not the quick ones over the board behind it.
    const sheet = within(screen.UNSAFE_getByType(Modal));
    // The words, then the groups, in the website's order and words.
    for (const heading of ['بحث بالكلمات', 'مصدر العملاء', 'راتب أساسي', 'راتب أساسي من', 'نوع العمولة', 'تاريخ النشر', 'التخصص', 'نوع الشركة', 'سنوات الخبرة', 'نوع التعاقد', 'المنطقة']) {
      expect(await sheet.findByRole('header', { name: heading })).toBeTruthy();
    }

    fireEvent.press(sheet.getByRole('button', { name: ar.track.primary }));
    // A group that takes one answer is a set of radio buttons: choosing one unchooses "any".
    fireEvent.press(sheet.getByRole('radio', { name: 'براتب أساسي' }));
    expect(sheet.getByRole('radio', { name: 'براتب أساسي' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(sheet.getByLabelText('راتب أساسي').props.accessibilityRole).toBe('radiogroup');
    fireEvent.press(await sheet.findByRole('button', { name: 'القاهرة الجديدة' }));
    fireEvent.press(sheet.getByRole('radio', { name: 'آخر 7 أيام' }));
    expect(await sheet.findByRole('button', { name: 'عرض النتائج · ⁦7⁩' })).toBeTruthy();

    fireEvent.press(sheet.getByRole('button', { name: 'عرض النتائج · ⁦7⁩' }));
    // The words the board was searched by are in the sheet's first field, and kept.
    await waitFor(() =>
      expect(result.getSearchParams()).toEqual({
        q: 'مبيعات',
        track: 'primary',
        district: 'new-cairo',
        salary: 'yes',
        posted: '7',
      }),
    );
  });

  it('clears what the sheet chose, the words with it, and nothing else', async () => {
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs?q=x&track=primary&pay=10000&sort=salary' });
    await screen.findByText(listing.title_ar);
    fireEvent.press(screen.getByRole('button', { name: 'الفلاتر · 3' }));
    // The sheet's own button, not the board's behind it.
    const sheet = within(screen.UNSAFE_getByType(Modal));
    fireEvent.press(sheet.getByRole('button', { name: 'امسح كل الفلاتر' }));
    expect(sheet.getByLabelText(ar.filters.search).props.value).toBe('');
    // Pressable at once, whether or not the count has come back.
    fireEvent.press(sheet.getByRole('button', { name: /عرض النتائج/ }));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ sort: 'salary' }));
  });

  it('narrows by the filters people reach for most, one tap each, and lets go of them the same way', async () => {
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    await screen.findByText(listing.title_ar);
    fireEvent.press(screen.getByRole('button', { name: 'براتب أساسي' }));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ salary: 'yes' }));
    fireEvent.press(screen.getByRole('button', { name: ar.track.resale }));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ salary: 'yes', track: 'resale' }));
    fireEvent.press(screen.getAllByRole('button', { name: 'براتب أساسي' })[0]);
    await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'resale' }));
  });

  it('re-sorts', async () => {
    const result = await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    await screen.findByText(listing.title_ar);
    // A small button naming the order; the three in a card it opens, radio
    // buttons in a group named for what they set.
    fireEvent.press(screen.getByRole('button', { name: 'رتّب حسب: الأحدث' }));
    expect(screen.getByLabelText('رتّب حسب').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'الأحدث' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('radio', { name: 'الأعلى راتبًا' }).props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(screen.getByText('الأعلى راتبًا'));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ sort: 'salary' }));
  });
});

describe('a listing', () => {
  it('does not ask the landing route for a listing whose title starts with a track', async () => {
    const slug = 'resale-consultant-new-cairo-482913';
    server.on(`/api/mobile/v1/jobs/${slug}`, jobPage);
    renderRouter(app, { initialUrl: `/(jobs)/jobs/${slug}` });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(server.asked(`/api/mobile/v1/landing/${slug}`)).toHaveLength(0);
    expect(server.asked(`/api/mobile/v1/jobs/${slug}`)).toHaveLength(1);
  });

  it('says since when the company is verified, and how soon it answers, from what it did with its applications', async () => {
    server.on('POST /rest/v1/rpc/company_response_stats', [{ sample: 20, open_rate: 0.92, median_days: 2.2 }]);
    await renderRouter(app, { initialUrl: `/(jobs)/jobs/${listing.slug}` });
    expect(await screen.findByText(new RegExp(`موثّقة منذ أغسطس 2026`))).toBeTruthy();
    expect(await screen.findByText('تردّ هذه الشركة خلال يومين في المتوسط · فتحت \u206692%\u2069 من الطلبات')).toBeTruthy();
    // No line for a company that has had too few applications to say.
    server.on('POST /rest/v1/rpc/company_response_stats', []);
  });

  it('reads like the website page and counts the view once', async () => {
    await renderRouter(app, { initialUrl: `/(jobs)/jobs/${listing.slug}` });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('بيع وحدات سكنية في مشروعات القاهرة الجديدة.')).toBeTruthy();
    expect(screen.getByText('بالم هيلز')).toBeTruthy();
    // The commission, on the listing alone (v1.1): its rate as a figure.
    expect(screen.getByText('\u20661.5%\u2069')).toBeTruthy();
    // What listings like it pay, with the currency and the sample size.
    expect(screen.getByText(/ج\.م — حسب ⁦6⁩ إعلانات منشورة/)).toBeTruthy();
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/recordJobView')).toHaveLength(1));
    expect(server.asked('/api/mobile/v1/actions/recordJobView')[0].body).toEqual({ input: { slug: listing.slug } });
  });

  it('opens a track-in-district page for a landing slug', async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', {
      track: 'primary',
      district: newCairo,
      facts: { listings: 1, companies: 1, withBasicSalary: 1, salaryFloor: 10000, salaryCeiling: 15000 },
    });
    await renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
    expect(await screen.findByText(landingTitle)).toBeTruthy();
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
  });

  it('leaves out the listings of a company this phone hides on a track-in-district page, as the board does', async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', {
      track: 'primary',
      district: newCairo,
      facts: { listings: 2, companies: 2, withBasicSalary: 1, salaryFloor: 10000, salaryCeiling: 15000 },
    });
    const other = {
      ...listing,
      id: '5b0c7d1e-0000-4000-8000-000000000102',
      slug: 'sales-manager-c3d4',
      title_ar: 'مدير مبيعات',
      company_id: 'c0000000-0000-4000-8000-000000000002',
      company: { ...listing.company, id: 'c0000000-0000-4000-8000-000000000002', slug: 'other-brokers' },
    };
    server.on('/api/mobile/v1/jobs', board([listing, other]));
    act(() => hideCompany(company.id));
    try {
      await renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
      expect(await screen.findByText(landingTitle)).toBeTruthy();
      expect(await screen.findByText(other.title_ar)).toBeTruthy();
      expect(screen.queryByText(listing.title_ar)).toBeNull();
    } finally {
      act(() => unhideCompany(company.id));
    }
  });

  it('says a track-in-district page has nothing to show when its only listing was hidden one by one, not a count over an empty space', async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', {
      track: 'primary',
      district: newCairo,
      facts: { listings: 1, companies: 1, withBasicSalary: 1, salaryFloor: 10000, salaryCeiling: 15000 },
    });
    server.on('/api/mobile/v1/jobs', board([listing]));
    act(() => hideJob(listing.id, { name: listing.title_ar, slug: listing.slug }));
    try {
      await renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
      expect(await screen.findByText(landingTitle)).toBeTruthy();
      expect(await screen.findByText(ar.jobs.empty)).toBeTruthy();
      expect(screen.queryByText(listing.title_ar)).toBeNull();
      // Counted as drawn — none — and no facts about listings it does not show.
      expect(screen.getByText('لا توجد نتائج')).toBeTruthy();
      expect(screen.queryByText('نتيجة واحدة')).toBeNull();
      expect(screen.queryByLabelText(ar.landing.factsLabel)).toBeNull();
    } finally {
      act(() => unhideJob(listing.id));
    }
  });

  // A first page of twenty, more on the server than the page holds.
  const firstPage = Array.from({ length: 20 }, (_, index) => ({
    ...listing,
    id: `5b0c7d1e-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
    slug: `sales-${index}`,
    title_ar: `وظيفة مبيعات رقم ${index + 1}`,
  }));
  const landingFacts = {
    track: 'primary',
    district: newCairo,
    facts: { listings: 21, companies: 1, withBasicSalary: 1, salaryFloor: 10000, salaryCeiling: 15000 },
  };

  it('keeps the way to the rest of a track-in-district page once a listing on its first page is hidden', async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', landingFacts);
    server.on('/api/mobile/v1/jobs', board(firstPage, { total: 21, pageCount: 2 }));
    act(() => hideJob(firstPage[0].id, { name: firstPage[0].title_ar, slug: firstPage[0].slug }));
    try {
      await renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
      expect(await screen.findByText(firstPage[1].title_ar)).toBeTruthy();
      // Twenty in all, nineteen drawn: the twenty-first is on the board.
      expect(screen.getByText(ar.nav.browseJobs)).toBeTruthy();
    } finally {
      act(() => unhideJob(firstPage[0].id));
    }
  });

  it('sends a track-in-district page whose first page is all hidden to the board for the rest, not "no jobs"', async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', { ...landingFacts, facts: { ...landingFacts.facts, listings: 30 } });
    server.on('/api/mobile/v1/jobs', board(firstPage, { total: 30, pageCount: 2 }));
    act(() => firstPage.forEach((job) => hideJob(job.id, { name: job.title_ar, slug: job.slug })));
    try {
      await renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
      expect(await screen.findByText(ar.nav.browseJobs)).toBeTruthy();
      expect(screen.queryByText(ar.jobs.empty)).toBeNull();
      expect(screen.queryByText(firstPage[0].title_ar)).toBeNull();
    } finally {
      act(() => firstPage.forEach((job) => unhideJob(job.id)));
    }
  });

  it("says a track-in-district page's listings could not be read, never that there are none", async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', {
      track: 'primary',
      district: newCairo,
      facts: { listings: 3, companies: 3, withBasicSalary: 0, salaryFloor: null, salaryCeiling: null },
    });
    server.on('/api/mobile/v1/jobs', { status: 503, body: { error: 'unavailable' } });
    await renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
    expect(await screen.findByText(landingTitle)).toBeTruthy();

    expect(await screen.findByRole('button', { name: ar.common.retry })).toBeTruthy();
    expect(screen.queryByText(ar.jobs.empty)).toBeNull();
    // Nor a count of none at the top (resultsCount at zero).
    expect(screen.queryByText('لا توجد نتائج')).toBeNull();

    // Read again on the retry.
    server.on('/api/mobile/v1/jobs', board());
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
  });

  it('says so when the listing is gone', async () => {
    await renderRouter(app, { initialUrl: '/(jobs)/jobs/gone-z9' });
    expect(await screen.findByText('الصفحة غير موجودة')).toBeTruthy();
  });
});

describe('companies', () => {
  it('lists them with their open roles', async () => {
    await renderRouter(app, { initialUrl: '/(companies)/companies' });
    expect(await screen.findByText('نايل بروكرز')).toBeTruthy();
    expect(screen.getByLabelText(/وظيفة مفتوحة واحدة/)).toBeTruthy();
  });

  it('searches them by name, and shows the words a link carries', async () => {
    const result = await renderRouter(app, { initialUrl: '/(companies)/companies?verified=1' });
    await screen.findByText('نايل بروكرز');
    const field = screen.getByLabelText(ar.filters.search);
    expect(field.props.placeholder).toBe(ar.app.companies.searchPlaceholder);
    fireEvent.changeText(field, ' نايل ');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(result.getSearchParams()).toEqual({ q: 'نايل', verified: '1' }));
    // Its chip and the field's clear mark each take the words off.
    fireEvent.press(screen.getByRole('button', { name: ar.app.search.clear }));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ verified: '1' }));
    result.unmount();

    await renderRouter(app, { initialUrl: '/(companies)/companies?q=%D9%86%D8%A7%D9%8A%D9%84' });
    await screen.findByText('نايل بروكرز');
    expect(screen.getByLabelText(ar.filters.search).props.value).toBe('نايل');
  });

  it("keeps a touch on the verified sheet in the sheet: the board's card it was opened from is not opened", async () => {
    const result = await renderRouter(app, { initialUrl: '/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    fireEvent.press(screen.getAllByRole('button', { name: ar.companies.verified })[0]);
    expect(await screen.findByText(ar.app.verified.title)).toBeTruthy();
    // The sheet's own words, tapped: not the listing under it.
    fireEvent.press(screen.getByText(ar.app.verified.papers));
    await act(async () => {});
    expect(result.getPathname()).toBe('/jobs');
    expect(screen.getByText(ar.app.verified.title)).toBeTruthy();
  });

  it('says what verified means when its mark is tapped', async () => {
    await renderRouter(app, { initialUrl: '/(companies)/companies' });
    await screen.findByText('نايل بروكرز');
    fireEvent.press(screen.getAllByRole('button', { name: ar.companies.verified })[0]);
    expect(await screen.findByText(ar.app.verified.title)).toBeTruthy();
    expect(screen.getByText(ar.app.verified.papers)).toBeTruthy();
    fireEvent.press(screen.getAllByRole('button', { name: ar.app.verified.close })[1]);
    await waitFor(() => expect(screen.queryByText(ar.app.verified.title)).toBeNull());
  });

  it("shows a company's page", async () => {
    await renderRouter(app, { initialUrl: '/(companies)/companies/nile-brokers' });
    // The name heads the page, and each of its listings names it again.
    expect(await screen.findByRole('header', { name: 'نايل بروكرز' })).toBeTruthy();
    expect(screen.getByText('وساطة عقارية في شرق القاهرة.')).toBeTruthy();
    expect(screen.getByText(listing.title_ar)).toBeTruthy();
  });
});

describe('reporting and hiding', () => {
  afterEach(() => {
    act(() => unhideCompany(company.id));
  });

  it('asks a signed-out reader to sign in first, and to come back to the listing', async () => {
    const result = await renderRouter(app, { initialUrl: `/(jobs)/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: 'بلّغ عن الإعلان' }));
    await waitFor(() => expect(result.getPathname()).toBe('/sign-in'));
    expect(result.getSearchParams().next).toBe(`/jobs/${listing.slug}`);
  });

  it("takes a hidden company's listings off the board, and brings them back from its page", async () => {
    // The confirmation's destructive choice, as a tap on it.
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    await renderRouter(app, { initialUrl: '/(companies)/companies/nile-brokers' });
    fireEvent.press(await screen.findByRole('button', { name: 'أخفِ هذه الشركة' }));
    expect(await screen.findByText('أنت تخفي هذه الشركة، فإعلاناتها لا تظهر لك في التطبيق.')).toBeTruthy();
    screen.unmount();

    await renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText('لا توجد وظائف مطابقة لبحثك.')).toBeTruthy();
    expect(screen.queryByText(listing.title_ar)).toBeNull();
    screen.unmount();

    await renderRouter(app, { initialUrl: '/(companies)/companies' });
    await screen.findAllByText(/شركات العقارات|الشركات/);
    await waitFor(() => expect(screen.queryByText('نايل بروكرز') === null).toBe(true));
    screen.unmount();

    // Listed by name under Account, out of every list as it is.
    await renderRouter(app, { initialUrl: '/account/hidden' });
    expect(await screen.findByText('نايل بروكرز')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'أظهِر نايل بروكرز' })).toBeTruthy();
    screen.unmount();

    await renderRouter(app, { initialUrl: '/(companies)/companies/nile-brokers' });
    fireEvent.press(await screen.findByRole('button', { name: 'أظهِر الشركة' }));
    expect(await screen.findByRole('button', { name: 'أخفِ هذه الشركة' })).toBeTruthy();
  });
});

afterAll(() => {
  act(() => {});
});

describe('search', () => {
  it('reads a track and a place in what is typed, and opens the board for both', async () => {
    // «التجمع» is one of New Cairo's other names (search_aliases, migration 68).
    server.on('/rest/v1/search_aliases', [{ alias: 'التجمع', district_id: newCairo.id, track: null }]);
    const result = await renderRouter(app, { initialUrl: '/jobs/search' });
    fireEvent.changeText(await screen.findByLabelText(ar.app.search.title), 'اوفبلان تجمع');
    expect(await screen.findByText(ar.app.search.didYouMean)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: `${ar.track.primary} · ${newCairo.name_ar}` }));
    await waitFor(() => expect(result.getPathname()).toBe('/jobs'));
    expect(result.getSearchParams()).toMatchObject({ track: 'primary', district: newCairo.slug });
  });

  it('searches the words as typed, and offers them again next time', async () => {
    const result = await renderRouter(app, { initialUrl: '/jobs/search' });
    fireEvent.changeText(await screen.findByLabelText(ar.app.search.title), 'مدير مبيعات');
    fireEvent(screen.getByLabelText(ar.app.search.title), 'submitEditing');
    await waitFor(() => expect(result.getPathname()).toBe('/jobs'));
    expect(result.getSearchParams()).toMatchObject({ q: 'مدير مبيعات' });
    act(() => router.push('/jobs/search'));
    expect(await screen.findByText(ar.app.search.recent)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.app.jobs.recentSearch.replace('{words}', 'مدير مبيعات') })).toBeTruthy();
  });
});
