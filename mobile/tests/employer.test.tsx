import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { CompanyRow, EmployerSummary, EmployerTrend, ProfileRow } from '@/lib/supabase/database.types';
import type { ConsoleListing } from '~/features/employer/listings';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as HomeScreen from '../src/app/(tabs)/(home)/index';
import * as ListingsScreen from '../src/app/(tabs)/(listings)/employer/jobs/index';
import { authSession, authUser, mobileConfig, ownedCompany, profile, USER_ID } from './auth-fixtures';
import { newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  An employer's console on the phone — the overview on Home and the listings
  — as the real screens draw them against stand-ins for Supabase and the
  website: what is said first, what each figure and button opens, which of
  the website's moves each listing offers, and the website's words when one
  is refused.
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
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();

const employerProfile: ProfileRow = { ...profile, role: 'employer', full_name: 'أحمد سمير' };
const myCompany: CompanyRow = { ...ownedCompany, about_ar: null, logo_url: null, verification_status: 'unverified' };

function summary(overrides: Partial<Extract<EmployerSummary, { has_company: true }>> = {}): EmployerSummary {
  return {
    has_company: true,
    live_jobs: 2,
    pending_jobs: 1,
    draft_jobs: 0,
    expiring_soon: 0,
    ended_jobs: 0,
    total_views: 340,
    seats_advertised: 6,
    applicants_total: 12,
    applicants_new: 3,
    applicants_unseen: 2,
    applicants_7d: 6,
    applicants_prev_7d: 4,
    credits: 1,
    verification: 'verified',
    ...overrides,
  };
}

const trend: EmployerTrend = {
  has_company: true,
  days: Array.from({ length: 30 }, (_, index) => ({ d: `2026-09-${String(index + 1).padStart(2, '0')}`, applications: index % 5 })),
  conversion: [{ id: 'j1', slug: 'sales-a1b2', title_ar: 'مستشار مبيعات', title_en: null, views: 200, applications: 8 }],
};

function listing(overrides: Partial<ConsoleListing> = {}): ConsoleListing {
  return {
    id: '5b0c7d1e-0000-4000-8000-000000000301',
    slug: 'sales-a1b2',
    title_ar: 'مستشار مبيعات',
    title_en: null,
    status: 'active',
    seats: 3,
    view_count: 120,
    published_at: '2026-09-10T10:00:00Z',
    expires_at: '2099-10-10T10:00:00Z',
    created_at: '2026-09-09T10:00:00Z',
    rejection_note: null,
    district: { name_ar: newCairo.name_ar, name_en: newCairo.name_en },
    applications: [{ count: 4 }],
    ...overrides,
  };
}

let me: ProfileRow;
let company: CompanyRow | null;
let listings: ConsoleListing[];

const warnings: string[] = [];
beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
  warnings.length = 0;
});

beforeEach(async () => {
  me = { ...employerProfile };
  company = { ...myCompany };
  listings = [listing()];

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => company?.id ?? null);
  server.on('GET /rest/v1/companies', () => (company ? [company] : []));
  server.on('POST /rest/v1/rpc/employer_summary', () => summary());
  server.on('POST /rest/v1/rpc/employer_trend', trend);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('POST /rest/v1/rpc/my_account_note', () => 'شكاوى من مرشحين عن إعلانات مضللة.');
  server.on('POST /rest/v1/rpc/my_appeal_state', { appealable: true, open: null, last: null });
  server.on('GET /rest/v1/company_moderation', [{ suspension_reason: 'إعلانات بمرتبات غير حقيقية.' }]);
  server.on('GET /rest/v1/jobs', () => ({
    body: listings,
    headers: { 'content-range': `0-${Math.max(listings.length - 1, 0)}/${listings.length}` },
  }));
  server.on('POST /api/mobile/v1/actions/transitionJob', { ok: true });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
});

async function signIn(approval: ProfileRow['approval_status'] = 'approved') {
  me = { ...employerProfile, approval_status: approval };
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({
    userId: USER_ID,
    profile: { role: 'employer', approval_status: approval },
    company: company ? { id: company.id, verification_status: company.verification_status } : null,
  });
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

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(home)/index': HomeScreen,
  '(tabs)/(listings)/employer/jobs/index': ListingsScreen,
  '(tabs)/(listings)/employer/jobs/new': stand('the wizard'),
  '(tabs)/(applicants)/employer/applicants/index': stand('the inbox'),
  '(tabs)/(account)/employer/company': stand('the company'),
  '(tabs)/(account)/employer/billing': stand('billing'),
};

describe("an employer's home", () => {
  it('opens on the overview: the applicants waiting first, then the work and the company in figures', async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: '/' });

    expect(await screen.findByText(ar.dashboard.overview)).toBeTruthy();
    expect(await screen.findByText('3 متقدمين مستنيين منك')).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statApplicantsNew}: 3`)).toBeTruthy();
    // Six this week against four the week before: up by half.
    expect(screen.getByLabelText(`${ar.dashboard.statApplicants7d}: 6، 50% ${ar.dashboard.vsLastWeek}`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statVerification}: ${ar.companies.verified}`)).toBeTruthy();
    // The month, and how each listing converts.
    expect(await screen.findByText(ar.dashboard.trendApplicationsTitle)).toBeTruthy();
    expect(screen.getByLabelText(/^مستشار مبيعات: 4%/)).toBeTruthy();
    // With listings up, the checklist has stood down.
    expect(screen.queryByText(ar.employer.setupTitle) === null).toBe(true);

    fireEvent.press(screen.getByRole('link', { name: `${ar.dashboard.statCredits}: 1` }));
    await waitFor(() => expect(result.getPathname()).toBe('/employer/billing'));
  });

  it('says what is left before the first listing, instead of a page of zeros', async () => {
    server.on('POST /rest/v1/rpc/employer_summary', () => summary({ live_jobs: 0, pending_jobs: 0, draft_jobs: 1, applicants_new: 0 }));
    await signIn();
    const result = renderRouter(app, { initialUrl: '/' });

    expect(await screen.findByText(ar.employer.setupTitle)).toBeTruthy();
    expect(screen.getByText('0 من 3')).toBeTruthy();
    expect(screen.getByText(ar.employer.setupFirstJobDraft)).toBeTruthy();
    expect(screen.queryByText(ar.dashboard.trendApplicationsTitle) === null).toBe(true);
    // A draft waiting is the next thing to do.
    fireEvent.press(await screen.findByRole('button', { name: ar.employer.setupPostFirstJob }));
    await waitFor(() => expect(result.getPathname()).toBe('/employer/jobs/new'));
  });

  it('asks for the company first when there is none', async () => {
    company = null;
    server.on('POST /rest/v1/rpc/employer_summary', { has_company: false });
    await signIn();
    const result = renderRouter(app, { initialUrl: '/' });

    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.emptyEmployerCta }));
    await waitFor(() => expect(result.getPathname()).toBe('/employer/company'));
  });

  it("tells a new employer their account is being reviewed, and a suspended company why, with the way to appeal", async () => {
    company = { ...myCompany, suspended_at: '2026-09-20T10:00:00Z' };
    server.on('POST /rest/v1/rpc/my_appeal_state', (_url: URL, init?: RequestInit) =>
      // The account's first review has no appeal; the company's suspension has one.
      JSON.parse(String(init?.body)).p_subject_type === 'company'
        ? { appealable: true, open: null, last: null }
        : { appealable: false, open: null, last: null },
    );
    await signIn('pending');
    renderRouter(app, { initialUrl: '/' });

    expect(await screen.findByText(ar.employer.pendingTitle)).toBeTruthy();
    expect(await screen.findByText(ar.standing.companySuspendedTitle)).toBeTruthy();
    expect(await screen.findByText('ملاحظة فريقنا: إعلانات بمرتبات غير حقيقية.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: ar.appeals.ask })).toBeTruthy();
    expect(screen.queryByText(ar.standing.heldTitle) === null).toBe(true);
  });
});

describe("an employer's listings", () => {
  it('shows each listing as the website does, and offers only the moves an employer may make', async () => {
    listings = [
      listing(),
      listing({ id: 'j-draft', slug: 'draft-1', title_ar: 'مسودة إعلان', status: 'draft', published_at: null, applications: [{ count: 0 }] }),
      listing({ id: 'j-old', slug: 'old-1', title_ar: 'إعلان قديم', expires_at: '2020-01-01T00:00:00Z' }),
      listing({
        id: 'j-rejected',
        slug: 'rejected-1',
        title_ar: 'إعلان مرفوض',
        status: 'rejected',
        rejection_note: 'المرتب مش واضح.',
      }),
    ];
    await signIn();
    renderRouter(app, { initialUrl: '/employer/jobs' });

    expect(await screen.findByText('4 نتائج')).toBeTruthy();
    // Live: closed from here; past its date: shown as ended and reopened — whatever the stored label says.
    expect(screen.getByRole('button', { name: `${ar.employer.closeJob}: مستشار مبيعات` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${ar.employer.reopenJob}: إعلان قديم` })).toBeTruthy();
    expect(screen.getByText(ar.jobStatus.expired)).toBeTruthy();
    expect(screen.getByRole('button', { name: `${ar.employer.submitForReview}: مسودة إعلان` })).toBeTruthy();
    // A rejected listing: the moderator's words, and the way to ask again.
    expect(screen.getByText('المرتب مش واضح.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: ar.appeals.ask })).toBeTruthy();
    // Applicants per listing.
    expect(screen.getByRole('button', { name: '⁦4⁩ متقدم: مستشار مبيعات' })).toBeTruthy();
  });

  it("closes a listing through the website, and says so in the website's words when it is refused", async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/employer/jobs' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.closeJob}: مستشار مبيعات` }));
    await waitFor(() =>
      expect(server.asked('/api/mobile/v1/actions/transitionJob')[0]?.body).toEqual({
        input: { jobId: '5b0c7d1e-0000-4000-8000-000000000301', status: 'closed' },
      }),
    );

    server.on('POST /api/mobile/v1/actions/transitionJob', { ok: false, error: 'company_suspended' });
    await waitFor(() => expect(screen.getByRole('button', { name: `${ar.employer.closeJob}: مستشار مبيعات` }).props.accessibilityState?.busy).toBe(false));
    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.closeJob}: مستشار مبيعات` }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/transitionJob')).toHaveLength(2));
    expect(await screen.findByText(ar.employer.companySuspendedBlocked)).toBeTruthy();
  });

  it('asks for the company before any listing', async () => {
    company = null;
    await signIn();
    renderRouter(app, { initialUrl: '/employer/jobs' });
    expect(await screen.findByText(ar.employer.createCompanyFirst)).toBeTruthy();
  });

  it('says a suspended account can do nothing here, rather than asking it to create a company', async () => {
    company = null;
    await signIn('rejected');
    renderRouter(app, { initialUrl: '/employer/jobs' });
    expect(await screen.findByText(ar.account.suspendedTitle)).toBeTruthy();
  });

  it('never offers the first listing to a company whose listings could not be read', async () => {
    server.on('GET /rest/v1/jobs', { status: 500, body: { message: 'down' } });
    await signIn();
    renderRouter(app, { initialUrl: '/employer/jobs' });
    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.queryByText(ar.employer.noJobs) === null).toBe(true);
  });
});
