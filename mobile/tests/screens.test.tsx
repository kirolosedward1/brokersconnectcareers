import { Stack, Tabs } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Modal, RefreshControl, type AlertButton } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { hideCompany, unhideCompany } from '~/features/moderation/hidden-companies';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { SessionProvider } from '~/lib/session';
import { ThemeProvider } from '~/theme/provider';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as CompanyScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/companies/[slug]';
import * as JobScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/jobs/[slug]';
import * as HomeScreen from '../src/app/(tabs)/(home)/index';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import * as CompaniesScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/companies/index';
import * as NotFoundScreen from '../src/app/+not-found';
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
const server = fakeServer();

const SPONSORED_FIRST = 'الإعلانات الممولة بتظهر في الأول، وبعدها الباقي بالترتيب اللي اخترته.';

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
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(home,jobs,companies)/_layout': TabStack,
  '(tabs)/(home,jobs,companies)/jobs/[slug]': JobScreen,
  '(tabs)/(home,jobs,companies)/companies/[slug]': CompanyScreen,
  '(tabs)/(home)/index': HomeScreen,
  '(tabs)/(jobs)/jobs/index': BoardScreen,
  '(tabs)/(companies)/companies/index': CompaniesScreen,
  '+not-found': NotFoundScreen,
};

describe('home', () => {
  it('leads with the search, the ways in and the newest roles', async () => {
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText('منصة متخصصة لوظائف العقارات في مصر')).toBeTruthy();
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    // The browse index, with the district's name from the taxonomy.
    expect(await screen.findByLabelText('القاهرة الجديدة، وظيفة واحدة')).toBeTruthy();
    expect(screen.getByText('وظائف شركات الوساطة')).toBeTruthy();
  });

  it('searches the board with the words typed', async () => {
    const result = renderRouter(app, { initialUrl: '/' });
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
    renderRouter(app, { initialUrl: '/(jobs)/jobs' });
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

  it('shows the listings, how many, and the pay in the website words', async () => {
    renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('نتيجة واحدة')).toBeTruthy();
    // The salary range with each number isolated left to right.
    expect(screen.getByText('⁦10,000⁩ – ⁦15,000⁩ جنيه')).toBeTruthy();
    // Nothing sponsored on the page, so nothing to explain about the order.
    expect(screen.queryByText(SPONSORED_FIRST)).toBeNull();
  });

  it('labels a sponsored listing, and says sponsored listings come first whatever the sort', async () => {
    server.on('/api/mobile/v1/jobs', board([{ ...listing, is_featured: true }]));
    renderRouter(app, { initialUrl: '/(jobs)/jobs?sort=salary' });
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
      renderRouter(app, { initialUrl: '/(jobs)/jobs' });
      expect(await screen.findByText(other.title_ar)).toBeTruthy();
      expect(screen.queryByText(listing.title_ar)).toBeNull();
      expect(screen.queryByText(SPONSORED_FIRST)).toBeNull();
    } finally {
      act(() => unhideCompany(company.id));
    }
  });

  it('tells VoiceOver everything a card shows: sponsored, closed, the pay and the rest, not only who and where', async () => {
    server.on('/api/mobile/v1/jobs', board([{ ...listing, is_featured: true, expires_at: new Date(Date.now() - 86_400_000).toISOString() }]));
    renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();

    const card = screen.getByRole('link', { name: new RegExp(`^${listing.title_ar}`) });
    const spoken = card.props.accessibilityLabel as string;
    for (const said of [
      'إعلان ممول',
      ar.jobs.closedShort,
      ar.companies.verified,
      '⁦10,000⁩ – ⁦15,000⁩ جنيه',
      ar.leadsSource.company_provided_short,
      ar.track.primary,
      ar.experienceBand.junior_1_3,
    ]) {
      expect(spoken).toContain(said);
    }
  });

  it('says "no basic salary", not "commission only", for a listing that has no commission either', async () => {
    server.on(
      '/api/mobile/v1/jobs',
      board([{ ...listing, basic_salary_min: null, basic_salary_max: null, commission_type: 'none', commission_value: null }]),
    );
    renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('من غير راتب أساسي')).toBeTruthy();
    expect(screen.queryByText('عمولة فقط')).toBeNull();
  });

  it('asks the server for exactly the filters in the address', async () => {
    renderRouter(app, { initialUrl: '/(jobs)/jobs?district=new-cairo&track=primary' });
    await screen.findByText(listing.title_ar);
    const asked = server.asked('/api/mobile/v1/jobs').map((request) => request.url.search);
    expect(asked).toContain('?track=primary&district=new-cairo');
  });

  it('shows each filter as a chip that removes it', async () => {
    const result = renderRouter(app, { initialUrl: '/(jobs)/jobs?district=new-cairo&track=primary' });
    await screen.findByText(listing.title_ar);
    fireEvent.press(await screen.findByLabelText('شيل فلتر القاهرة الجديدة'));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'primary' }));
  });

  it('drops the words searched when the search is left, by Cancel on iOS or the close on Android', async () => {
    for (const leave of ['onCancelButtonPress', 'onClose'] as const) {
      const result = renderRouter(app, { initialUrl: '/(jobs)/jobs?q=villa&track=primary' });
      await screen.findByText(listing.title_ar);
      const bar = screen.UNSAFE_root.find((node) => node.props.placeholder === 'مثال: استشاري عقاري' && Boolean(node.props[leave]));
      act(() => bar.props[leave]({ nativeEvent: {} }));
      await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'primary' }));
      result.unmount();
    }
  });

  it('offers the one filter to drop when nothing matches', async () => {
    server.on('/api/mobile/v1/jobs', board([], { relaxations: [{ key: 'district-new-cairo', count: 4 }] }));
    const result = renderRouter(app, { initialUrl: '/(jobs)/jobs?district=new-cairo&track=primary' });
    expect(await screen.findByText('مفيش وظائف مطابقة لبحثك.')).toBeTruthy();
    // Named from the taxonomy, which arrives beside the board.
    fireEvent.press(await screen.findByText('من غير القاهرة الجديدة · 4 وظائف'));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'primary' }));
  });

  it('offers every filter the website has, counts what they come to, and applies them in one go', async () => {
    // A narrowed board answers with how many it would show.
    server.on('/api/mobile/v1/jobs', (url: URL) => board([listing], { total: url.searchParams.has('track') ? 7 : 1 }));
    const result = renderRouter(app, { initialUrl: '/(jobs)/jobs?q=%D9%85%D8%A8%D9%8A%D8%B9%D8%A7%D8%AA' });
    await screen.findByText(listing.title_ar);

    fireEvent.press(screen.getByRole('button', { name: 'الفلاتر' }));
    // The groups, in the website's order and words.
    for (const heading of ['مصدر العملاء', 'راتب أساسي', 'راتب أساسي من', 'نوع العمولة', 'تاريخ النشر', 'التخصص', 'نوع الشركة', 'سنوات الخبرة', 'نوع التعاقد', 'المنطقة']) {
      expect(await screen.findByRole('header', { name: heading })).toBeTruthy();
    }

    fireEvent.press(screen.getByRole('button', { name: 'بيع أول' }));
    // A group that takes one answer is a set of radio buttons: choosing one unchooses "any".
    fireEvent.press(screen.getByRole('radio', { name: 'براتب أساسي' }));
    expect(screen.getByRole('radio', { name: 'براتب أساسي' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('راتب أساسي').props.accessibilityRole).toBe('radiogroup');
    fireEvent.press(await screen.findByRole('button', { name: 'القاهرة الجديدة' }));
    fireEvent.press(screen.getByRole('radio', { name: 'آخر 7 أيام' }));
    expect(await screen.findByRole('button', { name: 'شوف النتايج · ⁦7⁩' })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'شوف النتايج · ⁦7⁩' }));
    // The words typed in the search bar are kept; the rest is the sheet's.
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

  it('clears what the sheet chose, and nothing else', async () => {
    const result = renderRouter(app, { initialUrl: '/(jobs)/jobs?q=x&track=primary&pay=10000' });
    await screen.findByText(listing.title_ar);
    fireEvent.press(screen.getByRole('button', { name: 'الفلاتر · 2' }));
    // The sheet's own button, not the board's behind it.
    const sheet = within(screen.UNSAFE_getByType(Modal));
    fireEvent.press(sheet.getByRole('button', { name: 'امسح كل الفلاتر' }));
    // Pressable at once, whether or not the count has come back.
    fireEvent.press(sheet.getByRole('button', { name: /شوف النتايج/ }));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ q: 'x' }));
  });

  it('re-sorts', async () => {
    const result = renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    await screen.findByText(listing.title_ar);
    // One order of three: radio buttons in a group named for what they set.
    expect(screen.getByLabelText('رتّب حسب').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'الأحدث' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('radio', { name: 'الأعلى راتباً' }).props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(screen.getByText('الأعلى راتباً'));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ sort: 'salary' }));
  });
});

describe('a listing', () => {
  it('reads like the website page and counts the view once', async () => {
    renderRouter(app, { initialUrl: `/(jobs)/jobs/${listing.slug}` });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('بيع وحدات سكنية في مشروعات القاهرة الجديدة.')).toBeTruthy();
    expect(screen.getByText('بالم هيلز')).toBeTruthy();
    expect(screen.getByText('نسبة ⁦1.5⁩٪')).toBeTruthy();
    // What listings like it pay, with the sample size.
    expect(screen.getByText(/حسب 6 إعلانات شغّالة/)).toBeTruthy();
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/recordJobView')).toHaveLength(1));
    expect(server.asked('/api/mobile/v1/actions/recordJobView')[0].body).toEqual({ input: { slug: listing.slug } });
  });

  it('opens a track-in-district page for a landing slug', async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', {
      track: 'primary',
      district: newCairo,
      facts: { listings: 1, companies: 1, withBasicSalary: 1, salaryFloor: 10000, salaryCeiling: 15000 },
    });
    renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
    expect(await screen.findByText('وظائف بيع أول في القاهرة الجديدة')).toBeTruthy();
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
  });

  it("says a track-in-district page's listings could not be read, never that there are none", async () => {
    server.on('/api/mobile/v1/landing/primary-sales-new-cairo', {
      track: 'primary',
      district: newCairo,
      facts: { listings: 3, companies: 3, withBasicSalary: 0, salaryFloor: null, salaryCeiling: null },
    });
    server.on('/api/mobile/v1/jobs', { status: 503, body: { error: 'unavailable' } });
    renderRouter(app, { initialUrl: '/(jobs)/jobs/primary-sales-new-cairo' });
    expect(await screen.findByText('وظائف بيع أول في القاهرة الجديدة')).toBeTruthy();

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
    renderRouter(app, { initialUrl: '/(jobs)/jobs/gone-z9' });
    expect(await screen.findByText('الصفحة مش موجودة')).toBeTruthy();
  });
});

describe('companies', () => {
  it('lists them with their open roles', async () => {
    renderRouter(app, { initialUrl: '/(companies)/companies' });
    expect(await screen.findByText('نايل بروكرز')).toBeTruthy();
    expect(screen.getByLabelText(/وظيفة مفتوحة واحدة/)).toBeTruthy();
  });

  it("shows a company's page", async () => {
    renderRouter(app, { initialUrl: '/(companies)/companies/nile-brokers' });
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
    const result = renderRouter(app, { initialUrl: `/(jobs)/jobs/${listing.slug}` });
    fireEvent.press(await screen.findByRole('button', { name: 'بلّغ عن الإعلان' }));
    await waitFor(() => expect(result.getPathname()).toBe('/sign-in'));
    expect(result.getSearchParams().next).toBe(`/jobs/${listing.slug}`);
  });

  it("takes a hidden company's listings off the board, and brings them back from its page", async () => {
    // The confirmation's destructive choice, as a tap on it.
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    renderRouter(app, { initialUrl: '/(companies)/companies/nile-brokers' });
    fireEvent.press(await screen.findByRole('button', { name: 'اخفي الشركة دي' }));
    expect(await screen.findByText('انت مخبّي الشركة دي، فإعلاناتها مش بتظهرلك في التطبيق.')).toBeTruthy();
    screen.unmount();

    renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText('مفيش وظائف مطابقة لبحثك.')).toBeTruthy();
    expect(screen.queryByText(listing.title_ar)).toBeNull();
    screen.unmount();

    renderRouter(app, { initialUrl: '/(companies)/companies' });
    await screen.findByText(/شركات العقارات|الشركات/);
    await waitFor(() => expect(screen.queryByText('نايل بروكرز') === null).toBe(true));
    screen.unmount();

    renderRouter(app, { initialUrl: '/(companies)/companies/nile-brokers' });
    fireEvent.press(await screen.findByRole('button', { name: 'رجّع الشركة' }));
    expect(await screen.findByRole('button', { name: 'اخفي الشركة دي' })).toBeTruthy();
  });
});

afterAll(() => {
  act(() => {});
});
