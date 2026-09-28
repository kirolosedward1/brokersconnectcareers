import { Stack, Tabs } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { I18nProvider } from '~/i18n/provider';
import { SessionProvider } from '~/lib/session';
import { ThemeProvider } from '~/theme/provider';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies)/_layout';
import * as CompanyScreen from '../src/app/(tabs)/(home,jobs,companies)/companies/[slug]';
import * as JobScreen from '../src/app/(tabs)/(home,jobs,companies)/jobs/[slug]';
import * as HomeScreen from '../src/app/(tabs)/(home)/index';
import * as BoardScreen from '../src/app/(tabs)/(jobs)/jobs/index';
import * as CompaniesScreen from '../src/app/(tabs)/(companies)/companies/index';
import * as NotFoundScreen from '../src/app/+not-found';
import { board, browse, cairo, companyPage, directory, jobPage, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  The real screens, rendered against the website's API shapes: the home
  screen, the board, a listing, the directory and a company page, each drawn
  from fixtures through the same hooks and the same catalogue as on a phone.
  What this catches is everything a typecheck cannot — a provider missing, a
  message that fails to format, a parameter read under the wrong name.
*/

const server = fakeServer();

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

function Root() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
    expect(await screen.findByText('أفضل منصة لوظائف العقارات في مصر')).toBeTruthy();
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

describe('the board', () => {
  it('shows the listings, how many, and the pay in the website words', async () => {
    renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText('نتيجة واحدة')).toBeTruthy();
    // The salary range with each number isolated left to right.
    expect(screen.getByText('⁦10,000⁩ – ⁦15,000⁩ جنيه')).toBeTruthy();
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

  it('offers the one filter to drop when nothing matches', async () => {
    server.on('/api/mobile/v1/jobs', board([], { relaxations: [{ key: 'district-new-cairo', count: 4 }] }));
    const result = renderRouter(app, { initialUrl: '/(jobs)/jobs?district=new-cairo&track=primary' });
    expect(await screen.findByText('مفيش وظائف مطابقة لبحثك.')).toBeTruthy();
    // Named from the taxonomy, which arrives beside the board.
    fireEvent.press(await screen.findByText('من غير القاهرة الجديدة · 4 وظائف'));
    await waitFor(() => expect(result.getSearchParams()).toEqual({ track: 'primary' }));
  });

  it('re-sorts', async () => {
    const result = renderRouter(app, { initialUrl: '/(jobs)/jobs' });
    await screen.findByText(listing.title_ar);
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

afterAll(() => {
  act(() => {});
});
