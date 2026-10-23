import type { ReactNode } from 'react';
import { Modal, Text } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type {
  AdminOverview,
  AdminReportCase,
  AdminReportDetail,
  AdminSummary,
  AdminTrend,
  AdminUserSearchRow,
  JobRow,
  ProfileRow,
} from '@/lib/supabase/database.types';
import { formatNumber } from '@/lib/format';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { summaryWaiting } from '~/features/admin/queries';
import { rememberActor } from '~/lib/last-actor';
import { routeFromOutside, routeInside } from '~/lib/links';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { tabsFor } from '~/lib/tabs';
import { ThemeProvider } from '~/theme/provider';
import TabsLayout from '../src/app/(tabs)/_layout';
import * as HomeScreen from '../src/app/(tabs)/(home)/index';
import * as SharedLayout from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/_layout';
import * as OverviewScreen from '../src/app/(tabs)/(admin)/admin/index';
import * as ListingsScreen from '../src/app/(tabs)/(admin)/admin/jobs/index';
import * as ListingScreen from '../src/app/(tabs)/(admin)/admin/jobs/[id]';
import * as ReportsScreen from '../src/app/(tabs)/(admin)/admin/reports/index';
import * as AccountsScreen from '../src/app/(tabs)/(admin)/admin/users/index';
import * as CompaniesScreen from '../src/app/(tabs)/(admin)/admin/companies/index';
import * as CompanyScreen from '../src/app/(tabs)/(admin)/admin/companies/[id]';
import { DeclaredTabs } from './declared-tabs';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { company } from './fixtures';
import { fakeServer } from './server';

/*
  The admin console in the app — the Admin tab — as the real screens draw it
  against stand-ins for Supabase and the website: who has the tab, the door
  (the authenticator the website's console asks for), the queues, and the
  levers, each through the website's own admin action with what the screen
  showed (the version, the reason), and nothing said to be done before the
  website says it is.
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
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const JOB_ID = '5b0c7d1e-0000-4000-8000-000000000301';
const OTHER_USER = '8b7c7f1e-0000-4000-8000-000000000099';
const DOC_ID = 'd0c00000-0000-4000-8000-000000000001';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const overview: AdminOverview = {
  jobs: {
    live: 14,
    pending: 3,
    pending_24h: 1,
    expired: 2,
    closed: 0,
    rejected: 1,
    draft: 0,
    expiring_7d: 2,
    featured: 0,
    live_no_applicants: 5,
  },
  applications: { total: 40, last_7d: 6, prev_7d: 4, unopened_7d: 2 },
  companies: { total: 10, hiring: 5, pending: 2, verified: 3, suspended: 0 },
  accounts: { candidates: 30, employers: 8, admins: 1, pending: 4, suspended: 1, signups_7d: 5 },
  agents: { total: 12, public: 8, gated: 2, hidden: 2, restricted: 0 },
  reports: { open_targets: 2, open_jobs: 1, open_companies: 1, open_agents: 0, investigating: 0, last_7d: 3 },
  recent: [
    {
      id: 7,
      actor_name: 'كيرلس إدوارد',
      action: 'job.approve',
      target_type: 'job',
      target_id: JOB_ID,
      target_label: 'مستشار مبيعات',
      via: 'console',
      created_at: '2026-10-20T10:00:00Z',
    },
  ],
  generated_at: '2026-10-22T10:00:00Z',
};

/** The website rail's figures (admin_summary), which the tab's badge adds up. */
const summary: AdminSummary = {
  queue_total: 3,
  queue_over_24h: 1,
  reports_open: 2,
  appeals_open: 1,
  companies_pending: 2,
  accounts_pending: 4,
  companies_total: 10,
  live_jobs: 14,
  candidates: 30,
  employers: 8,
  signups_7d: 5,
  published_7d: 3,
  applications_7d: 6,
};

/** Thirty days, the last of them busy. */
const trend: AdminTrend = {
  days: Array.from({ length: 30 }, (_, i) => ({
    d: `2026-${String(i < 8 ? 9 : 10).padStart(2, '0')}-${String(i < 8 ? 23 + i : i - 7).padStart(2, '0')}`,
    signups: i === 29 ? 5 : 0,
    published: i === 29 ? 3 : 0,
    applications: i === 29 ? 6 : 1,
  })),
};

const REQUEST_ID = 'de1e7e00-0000-4000-8000-000000000001';

const deletionRequest = {
  id: REQUEST_ID,
  reference: 'BC-7Q2M',
  created_at: '2026-10-18T10:00:00Z',
  user_id: OTHER_USER,
};

const pendingJob = {
  id: JOB_ID,
  slug: 'sales-a1b2',
  title_ar: 'مستشار مبيعات',
  title_en: null,
  status: 'pending_review',
  created_at: '2026-10-19T10:00:00Z',
  version: 4,
  company: { id: company.id, name_ar: company.name_ar, name_en: null, verification_status: 'unverified', suspended_at: null },
};

const job: JobRow & { company: object; district: object } = {
  id: JOB_ID,
  company_id: company.id,
  title_ar: 'مستشار مبيعات',
  title_en: null,
  slug: 'sales-a1b2',
  track: 'primary',
  employment_type: 'full_time',
  experience_band: 'junior_1_3',
  seats: 3,
  district_id: 1,
  basic_salary_min: 8000,
  basic_salary_max: 12000,
  commission_type: 'percentage',
  commission_value: 1.5,
  commission_note_ar: null,
  leads_source: 'company_provided',
  benefits: [],
  description_ar: 'ادفع ٥٠٠ جنيه رسوم تدريب قبل البدء.',
  description_en: null,
  requirements_ar: null,
  status: 'pending_review',
  is_featured: false,
  featured_until: null,
  published_at: null,
  expires_at: null,
  view_count: 0,
  rejection_note: null,
  version: 4,
  idempotency_key: null,
  created_at: '2026-10-19T10:00:00Z',
  company: { id: company.id, name_ar: company.name_ar, name_en: null, slug: company.slug, verification_status: 'unverified', suspended_at: null },
  district: { name_ar: 'التجمع الخامس', name_en: 'Fifth Settlement' },
};

const reportCase: AdminReportCase = {
  target_type: 'job',
  target_id: JOB_ID,
  label_ar: 'مستشار مبيعات',
  label_en: null,
  company_id: company.id,
  company_name_ar: company.name_ar,
  company_name_en: null,
  target_state: 'active',
  reports: 2,
  reporters: 2,
  open_reports: 2,
  investigating_reports: 0,
  system_flags: 0,
  max_severity: 3,
  reasons: ['scam', 'scam'],
  first_at: '2026-10-18T10:00:00Z',
  last_at: '2026-10-20T10:00:00Z',
  fresh_reporters: 0,
  noisy_reporters: 0,
  employer_reporters: 0,
  report_ids: ['r1'],
  total_count: 1,
};

const reportRow = {
  id: 'r1',
  target_type: 'job',
  target_id: JOB_ID,
  target_live: true,
  reason: 'scam',
  severity: 3,
  detail: 'طلبوا فلوس قبل المقابلة.',
  status: 'open',
  source: 'user',
  abusive: false,
  created_at: '2026-10-20T10:00:00Z',
  resolved_at: null,
  target_snapshot: {},
  reporter_id: OTHER_USER,
  reporter_name: 'منى علي',
  reporter_role: 'candidate',
  reporter_since: '2026-01-01T10:00:00Z',
  reporter_company_ar: null,
  reporter_company_en: null,
  reporter_filed: 1,
  reporter_dismissed: 0,
  reporter_abusive: 0,
  reporter_restricted: false,
  total_count: 1,
} as AdminReportDetail;

const pendingAccount: AdminUserSearchRow = {
  id: OTHER_USER,
  role: 'employer',
  full_name: 'أحمد سمير',
  avatar_url: null,
  approval_status: 'pending',
  approval_note: null,
  created_at: '2026-10-21T10:00:00Z',
  company_id: company.id,
  company_name_ar: company.name_ar,
  company_name_en: null,
  agent_slug: null,
  agent_restricted: false,
  total_count: 1,
};

let me: ProfileRow;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('POST /rest/v1/rpc/admin_overview', () => overview);
  server.on('POST /rest/v1/rpc/admin_summary', () => summary);
  server.on('POST /rest/v1/rpc/admin_trend', () => trend);
  // Nobody asking to leave, and mail switched on, unless a test says otherwise.
  server.on('GET /rest/v1/support_requests', () => []);
  server.on('GET /api/mobile/v1/admin/mail', { configured: true, missing: [] });
  server.on('GET /rest/v1/jobs', (url: URL) =>
    url.searchParams.get('status') === 'eq.pending_review'
      ? { body: [pendingJob], headers: { 'content-range': '0-0/1' } }
      : [job],
  );
  server.on('POST /rest/v1/rpc/admin_job_signals', [
    { job_id: JOB_ID, flags: [{ flag: 'asks_for_money', weight: 'high', evidence: '٥٠٠ جنيه رسوم' }], company_id: company.id, company_signals: { signals: [] } },
  ]);
  server.on('GET /rest/v1/job_moderation', []);
  server.on('GET /rest/v1/reports', []);
  // The review's five head counts, one per stage.
  server.on('HEAD /rest/v1/applications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('GET /rest/v1/admin_audit_log', []);
  server.on('GET /rest/v1/moderation_notes', []);
  server.on('POST /rest/v1/rpc/admin_report_cases', [reportCase]);
  server.on('POST /rest/v1/rpc/admin_report_rows', [reportRow]);
  server.on('POST /rest/v1/rpc/admin_search_users', [pendingAccount]);
  server.on('GET /rest/v1/companies', () => ({
    body: [
      {
        id: company.id,
        name_ar: company.name_ar,
        name_en: null,
        slug: company.slug,
        logo_url: null,
        verification_status: 'pending',
        suspended_at: null,
        created_at: '2026-10-20T10:00:00Z',
        jobs: [{ count: 3 }],
        company_members: [{ count: 1 }],
        company_documents: [{ id: DOC_ID }],
      },
    ],
    headers: { 'content-range': '0-0/1' },
  }));
  server.on('POST /api/mobile/v1/actions/moderateJob', { ok: true });
  server.on('POST /api/mobile/v1/actions/moderateReports', { ok: true, data: { moved: 1 } });
  server.on('POST /api/mobile/v1/actions/setAccountApproval', { ok: true });
  server.on('POST /api/mobile/v1/actions/reviewCompany', { ok: true });
  server.on('POST /api/mobile/v1/actions/getDocumentUrl', { ok: true, data: { url: 'https://storage.example/doc?token=abc' } });
  server.on('POST /api/mobile/v1/actions/closeDeletionRequest', { ok: true });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
  jest.mocked(WebBrowser.openBrowserAsync).mockClear();
});

/** An admin, signed in with their authenticator's code (aal2) unless told otherwise. */
async function signIn({ aal = 'aal2', factor = true }: { aal?: 'aal1' | 'aal2'; factor?: boolean } = {}) {
  const user = authUser(factor ? { factors: [totpFactor] } : {});
  server.on('POST /auth/v1/token', () => authSession(user, aal));
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: me.role, approval_status: me.approval_status }, company: null });
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
              <DecisionSheetHost />
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
  '(tabs)/_layout': () => <DeclaredTabs routes={app} />,
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(admin)/admin/index': OverviewScreen,
  '(tabs)/(admin)/admin/jobs/index': ListingsScreen,
  '(tabs)/(admin)/admin/jobs/[id]': ListingScreen,
  '(tabs)/(admin)/admin/reports/index': ReportsScreen,
  '(tabs)/(admin)/admin/users/index': AccountsScreen,
  '(tabs)/(admin)/admin/users/[id]': stand('an account'),
  '(tabs)/(admin)/admin/companies/index': CompaniesScreen,
  '(tabs)/(admin)/admin/companies/[id]': CompanyScreen,
  // The rest of the console, as the overview's figures and rows open it.
  '(tabs)/(admin)/admin/applications/index': stand('the applications'),
  '(tabs)/(admin)/admin/agents/index': stand('the consultants'),
  '(tabs)/(admin)/admin/search/index': stand('the search'),
  '(tabs)/(admin)/admin/audit/index': stand('the audit log'),
  '(tabs)/(admin)/admin/appeals/index': stand('the appeals'),
  '(tabs)/(admin)/admin/taxonomy/index': stand('the taxonomy'),
  '(tabs)/(admin)/admin/email/index': stand('the email activity'),
  '(tabs)/(admin)/admin/operations/index': stand('the background work'),
  '(tabs)/(admin)/admin/security/index': stand('the security'),
  mfa: stand('the code screen'),
  'mfa-enrol': stand('setting up two-step'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

const admin = (company: { id: string } | null = null) => ({
  userId: USER_ID,
  profile: { role: 'admin' as const, approval_status: 'approved' as const },
  company: company ? { id: company.id, verification_status: 'verified' as const } : null,
});

const SHARED = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)';

/** The app's own tab bar, with the real Admin tab and its screen. */
const tabbed = {
  _layout: Root,
  '(tabs)/_layout': TabsLayout,
  [`${SHARED}/_layout`]: SharedLayout,
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(jobs)/jobs/index': stand('board'),
  [`${SHARED}/companies/index`]: stand('companies'),
  '(tabs)/(applications)/dashboard/applications/index': stand('applications'),
  '(tabs)/(saved)/dashboard/saved/index': stand('saved'),
  '(tabs)/(admin)/admin/index': OverviewScreen,
  '(tabs)/(account)/account/index': stand('account'),
};

describe('the tab bar', () => {
  it('gives an admin the Admin tab, wearing what waits on a decision', async () => {
    await signIn();
    await renderRouter(tabbed, { initialUrl: '/' });
    await screen.findByText('home');

    // The website rail's sense of waiting (admin_summary): 3 in the queue + 2
    // companies pending + 2 reported targets + 1 open appeal + 4 accounts,
    // said with the tab's name.
    await waitFor(() => {
      const labels = screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel as string);
      expect(labels.some((label) => label.startsWith(ar.admin.title) && /12/.test(label))).toBe(true);
    });
    expect(server.asked('/rest/v1/rpc/admin_summary')).toHaveLength(1);
  });

  it('counts what the rail counts, and no appeals on a database that has none yet', () => {
    expect(summaryWaiting(summary)).toBe(12);
    // Before migration 328 the function answers without appeals_open: none, never unreadable.
    const { appeals_open: _absent, ...older } = summary;
    expect(summaryWaiting(older)).toBe(11);
    expect(summaryWaiting(undefined)).toBe(0);
  });

  it('and nobody else', async () => {
    me = { ...me, role: 'candidate' };
    await signIn();
    await renderRouter(tabbed, { initialUrl: '/' });
    await screen.findByText('home');

    const labels = screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel as string);
    expect(labels.some((label) => label.startsWith(ar.admin.title))).toBe(false);
    expect(server.requests.some((request) => request.url.pathname.startsWith('/rest/v1/rpc/admin_'))).toBe(false);
  });
});

describe('who has the Admin tab', () => {
  it('is an admin: the console and the account alone, or beside the console of a company they run', () => {
    // Nothing of the public site's: no Home, no board, no companies directory.
    expect(tabsFor(admin())).toEqual(['admin', 'account']);
    expect(tabsFor(admin(company))).toEqual(['home', 'listings', 'applicants', 'admin', 'account']);
    for (const role of ['candidate', 'employer'] as const) {
      const actor = { userId: USER_ID, profile: { role, approval_status: 'approved' as const }, company: null };
      expect(tabsFor(actor)).not.toContain('admin');
    }
    expect(tabsFor(null)).not.toContain('admin');
  });

  it("opens the console's links in that tab, and nobody else's", () => {
    expect(routeFromOutside('https://www.brokersconnect.net/admin/reports', admin())).toBe('/(admin)/admin/reports');
    expect(routeInside(`/admin/jobs/${JOB_ID}`, admin())).toBe(`/admin/jobs/${JOB_ID}`);
    // Every page of the website's console opens natively, by the website's own path…
    expect(routeInside('/admin/audit', admin())).toBe('/admin/audit');
    expect(routeInside(`/admin/companies/${JOB_ID}`, admin())).toBe(`/admin/companies/${JOB_ID}`);
    expect(routeInside('/admin/users/ABCDEF01-2345-4678-8ABC-DEF012345678', admin())).toBe('/admin/users/ABCDEF01-2345-4678-8ABC-DEF012345678');
    // …and a path the console does not have opens the app's overview.
    expect(routeInside('/admin/nowhere', admin())).toBe('/admin');
    const candidate = { userId: USER_ID, profile: { role: 'candidate' as const, approval_status: 'approved' as const }, company: null };
    expect(routeFromOutside('https://www.brokersconnect.net/admin', candidate)).toBe('/');
    expect(routeFromOutside('https://www.brokersconnect.net/admin', null)).toBe('/sign-in?next=%2Fadmin');
  });

  it("opens a public page the console points at inside the Admin tab, as an admin's bar has no Home", () => {
    expect(routeFromOutside('https://www.brokersconnect.net/jobs/some-listing', admin())).toBe('/(admin)/jobs/some-listing');
    expect(routeFromOutside('https://www.brokersconnect.net/companies/some-company', admin())).toBe('/(admin)/companies/some-company');
    expect(routeFromOutside('https://www.brokersconnect.net/notifications', admin())).toBe('/(admin)/notifications');
    // The board itself is the Jobs tab's alone, which an admin does not have: home, which is the console.
    expect(routeFromOutside('https://www.brokersconnect.net/jobs', admin())).toBe('/');
  });

  it("draws only the console and the account in an admin's bar, and opens the console at the app's start", async () => {
    await signIn();
    const result = await renderRouter({ ...tabbed, '(tabs)/(home)/index': HomeScreen }, { initialUrl: '/' });
    await waitFor(() => expect(result.getPathname()).toBe('/admin'));
    const names = screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel as string);
    expect(names.some((name) => name.startsWith(ar.admin.title))).toBe(true);
    expect(names.some((name) => name.startsWith(ar.app.tabs.account))).toBe(true);
    expect(names.some((name) => name.startsWith(ar.app.tabs.home))).toBe(false);
    expect(names.some((name) => name.startsWith(ar.nav.jobs))).toBe(false);
    expect(names.some((name) => name.startsWith(ar.app.tabs.companies))).toBe(false);
    expect(names).toHaveLength(2);
  });

  it('keeps the consultant directory for an admin who runs a company, inside the Admin tab', () => {
    // Their bar has the company's console where the Consultants tab would be;
    // the directory and the shortlist open in the Admin tab's stack instead.
    expect(routeFromOutside('https://www.brokersconnect.net/agents', admin(company))).toBe('/(admin)/agents');
    expect(routeInside('/employer/talent', admin(company))).toBe('/employer/talent');
    expect(routeFromOutside('https://www.brokersconnect.net/agents', admin())).toBe('/(admin)/agents');
  });
});

describe('the door', () => {
  it('says the sign-in level could not be read, with a retry — never that there is no authenticator', async () => {
    await signIn({ aal: 'aal2', factor: true });
    // Every reader of the level (the session provider asks too), until the retry.
    const level = jest
      .spyOn(supabase.auth.mfa, 'getAuthenticatorAssuranceLevel')
      .mockResolvedValue({ data: null, error: Object.assign(new Error('storage'), { name: 'AuthError', status: 0 }) } as never);
    await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.common.error)).toBeTruthy();
    expect(screen.queryByText(ar.app.admin.door.enrolTitle)).toBeNull();
    level.mockRestore();
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(ar.admin.needsAttention)).toBeTruthy();
  });

  it("says the deployment's rule could not be read, with a retry — never 'set up two-step' for a dropped connection", async () => {
    server.on('GET /api/mobile/v1/config', { status: 503, body: { error: 'unavailable' } });
    await signIn({ aal: 'aal1', factor: false });
    await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.common.error)).toBeTruthy();
    expect(screen.queryByText(ar.app.admin.door.enrolTitle)).toBeNull();
    server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(ar.app.admin.door.enrolTitle)).toBeTruthy();
  });

  it('asks an admin without an authenticator to set one up first — on the phone — and reads nothing of the console', async () => {
    await signIn({ aal: 'aal1', factor: false });
    const result = await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.app.admin.door.enrolTitle)).toBeTruthy();
    expect(server.requests.some((request) => request.url.pathname.startsWith('/rest/v1/rpc/admin_'))).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: ar.account.mfaSetup }));
    await waitFor(() => expect(result.getPathname()).toBe('/mfa-enrol'));
    // Never the website.
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  it('opens where the deployment does not require an authenticator', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: false }));
    await signIn({ aal: 'aal1', factor: false });
    await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.admin.needsAttention)).toBeTruthy();
  });

  it('asks for the code from an admin whose authenticator has not been used this session', async () => {
    await signIn({ aal: 'aal1', factor: true });
    const result = await renderRouter(app, { initialUrl: '/admin' });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.admin.door.challengeGo }));
    await waitFor(() => expect(result.getPathname()).toBe('/mfa'));
  });
});

describe('the overview', () => {
  it('says what waits on a decision, each figure the way to its queue', async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin' });

    // The first row: what waits on a person, the website's five cells.
    expect(await screen.findByLabelText(`${ar.dashboard.statQueue}: 3`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statQueueOld}: 1`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statReports}: 2`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statCompaniesPending}: 2`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statAccountsPending}: 4`)).toBeTruthy();
    // The marketplace: live, expiring, quiet, expired, this week's applications (up by two), unopened.
    expect(screen.getByText(ar.admin.marketplace)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statLiveJobs}: 14`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statExpiring}: 2`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statNoApplicants}: 5`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statExpired}: 2`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statApplications7d}: 6، 2 ${ar.dashboard.vsLastWeek}`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statUnopened}: 2`)).toBeTruthy();
    // The people and the companies: the directory counts the public and gated profiles, the hidden ones said beside.
    expect(screen.getByText(ar.admin.population)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statCompaniesHiring}: 5`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statCompaniesVerified}: 3`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statCandidates}: 30`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statEmployers}: 8`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statSignups}: 5`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statAgents}: 10`)).toBeTruthy();
    expect(screen.getByText(ar.admin.statAgentsHint.replace('{hidden}', '2'), { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statSuspendedAccounts}: 1`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statSuspendedCompanies}: 0`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.statRestrictedConsultants}: 0`)).toBeTruthy();
    // Thirty days of activity, the three series the website draws.
    expect(screen.getByText(ar.dashboard.trendActivityTitle)).toBeTruthy();
    expect(screen.getByText(ar.dashboard.trendPublished)).toBeTruthy();
    expect(screen.getByText(ar.dashboard.trendSignups)).toBeTruthy();
    // The decisions made lately, in the website's words.
    expect(screen.getByText(ar.admin.auditAction.job_approve, { exact: false })).toBeTruthy();
    // Nobody asking to leave: no section for it.
    expect(screen.queryByText(ar.admin.deletionRequests)).toBeNull();

    fireEvent.press(screen.getByLabelText(`${ar.dashboard.statQueue}: 3`));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/jobs'));
    expect(await screen.findByText('مستشار مبيعات')).toBeTruthy();
    // What its own words flag, before it is opened.
    expect(screen.getByText(ar.admin.flag.asks_for_money, { exact: false })).toBeTruthy();
  });

  it("opens each figure's own list, by the website's path and filter", async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin' });

    fireEvent.press(await screen.findByLabelText(`${ar.dashboard.statLiveJobs}: 14`));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/jobs'));
    expect(result.getSearchParams()).toEqual({ status: 'live' });

    act(() => router.navigate('/admin'));
    fireEvent.press(await screen.findByLabelText(`${ar.admin.statUnopened}: 2`));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/applications'));
    expect(result.getSearchParams()).toEqual({ status: 'unopened' });

    act(() => router.navigate('/admin'));
    fireEvent.press(await screen.findByLabelText(`${ar.admin.statRestrictedConsultants}: 0`));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/agents'));
    expect(result.getSearchParams()).toEqual({ visibility: 'restricted' });

    act(() => router.navigate('/admin'));
    fireEvent.press(await screen.findByLabelText(`${ar.admin.statCandidates}: 30`));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/users'));
    expect(result.getSearchParams()).toEqual({ role: 'candidate' });

    act(() => router.navigate('/admin'));
    fireEvent.press(await screen.findByLabelText(`${ar.admin.statSuspendedCompanies}: 0`));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/companies'));
    expect(result.getSearchParams()).toEqual({ status: 'suspended' });
  });

  it('opens a recent decision where it was decided, the audit log, and the search', async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin' });

    fireEvent.press(await screen.findByRole('link', { name: `${ar.admin.auditAction.job_approve} — مستشار مبيعات` }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/jobs/${JOB_ID}`));

    act(() => router.navigate('/admin'));
    // The recent decisions' own way to the whole log, above the section list's row of the same name.
    fireEvent.press((await screen.findAllByRole('link', { name: ar.admin.auditLog }))[0]!);
    await waitFor(() => expect(result.getPathname()).toBe('/admin/audit'));

    act(() => router.navigate('/admin'));
    const field = (await screen.findAllByLabelText(ar.admin.search)).find((element) => element.props.placeholder !== undefined)!;
    expect(field.props.placeholder).toBe(ar.admin.searchEverythingPlaceholder);
    fireEvent.changeText(field, ' منى ');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(result.getPathname()).toBe('/admin/search'));
    expect(result.getSearchParams()).toEqual({ q: 'منى' });
  });

  it('reaches every part of the console, in the website rail\'s order, with what waits in each', async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin' });
    await screen.findByText(ar.app.admin.overview.sections);

    const sections: readonly [label: string, path: string, waiting?: number][] = [
      [ar.admin.jobsQueue, '/admin/jobs', summary.queue_total],
      [ar.admin.companiesQueue, '/admin/companies', summary.companies_pending],
      [ar.admin.reports, '/admin/reports', summary.reports_open],
      [ar.admin.appeals, '/admin/appeals', summary.appeals_open],
      [ar.admin.users, '/admin/users', summary.accounts_pending],
      [ar.admin.applications, '/admin/applications'],
      [ar.admin.agents, '/admin/agents'],
      [ar.admin.search, '/admin/search'],
      [ar.admin.auditLog, '/admin/audit'],
      [ar.admin.taxonomy, '/admin/taxonomy'],
      [ar.admin.emailActivity, '/admin/email'],
      [ar.admin.operations, '/admin/operations'],
      [ar.admin.security, '/admin/security'],
    ];
    for (const [label, path, waiting] of sections) {
      const name = waiting ? `${label}: ${formatNumber(waiting, 'ar')}` : label;
      const links = await screen.findAllByRole('link', { name });
      // The last of its name: the section list closes the screen.
      fireEvent.press(links[links.length - 1]!);
      await waitFor(() => expect(result.getPathname()).toBe(path));
      expect(result.getSearchParams()).toEqual({});
      act(() => router.navigate('/admin'));
      await screen.findByText(ar.app.admin.overview.sections);
    }
  });

  it('lists the owners asking to leave while there are any, and closes a request through the website', async () => {
    server.on('GET /rest/v1/support_requests', (url: URL) => {
      // Only the columns the website reads — never the message — and only the open deletion requests, oldest first.
      expect(url.searchParams.get('select')).toBe('id,reference,created_at,user_id');
      expect(url.searchParams.get('topic')).toBe('eq.account_deletion');
      expect(url.searchParams.get('status')).toBe('eq.open');
      expect(url.searchParams.get('order')).toBe('created_at.asc');
      expect(url.searchParams.get('limit')).toBe('50');
      return [deletionRequest];
    });
    // The owners' names, looked up by their ids; the viewer's own profile as before.
    server.on('/rest/v1/profiles', (url: URL) =>
      url.searchParams.get('id')?.startsWith('in.') ? [{ id: OTHER_USER, full_name: 'أحمد سمير' }] : [me],
    );
    server.on('GET /rest/v1/companies', (url: URL) =>
      url.searchParams.has('owner_id') ? [{ id: company.id, name_ar: company.name_ar, owner_id: OTHER_USER }] : [],
    );
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.admin.deletionRequests)).toBeTruthy();
    expect(screen.getByText('BC-7Q2M')).toBeTruthy();
    // The account and its company, each the way to its file.
    fireEvent.press(screen.getByRole('link', { name: company.name_ar }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/companies/${company.id}`));
    act(() => router.navigate('/admin'));
    fireEvent.press(await screen.findByRole('link', { name: 'أحمد سمير' }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/users/${OTHER_USER}`));
    act(() => router.navigate('/admin'));

    // Closing it records only that: confirmed, no reason asked, the request's id and nothing else sent.
    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.deletionRequestClose}: BC-7Q2M` }));
    expect(await screen.findByText(ar.app.admin.overview.closeDeletionBody)).toBeTruthy();
    expect(screen.queryByLabelText(ar.admin.reasonLabel)).toBeNull();
    expect(shownToast()).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.deletionRequestClose }).at(-1)!);
    });
    await waitFor(() => expect(actionsCalled('closeDeletionRequest')).toHaveLength(1));
    expect(actionsCalled('closeDeletionRequest')[0].body).toEqual({ input: { requestId: REQUEST_ID } });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.deletionRequestClose} — BC-7Q2M`));
  });

  it('says a request whose account is gone as that', async () => {
    server.on('GET /rest/v1/support_requests', () => [{ ...deletionRequest, user_id: null }]);
    await signIn();
    await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.admin.deletionRequestAccountGone)).toBeTruthy();
    // No account to look up: nothing asked of the profiles or the companies for it.
    expect(
      server.requests.some((request) => request.url.pathname === '/rest/v1/profiles' && request.url.searchParams.get('id')?.startsWith('in.')),
    ).toBe(false);
    expect(server.requests.some((request) => request.url.pathname === '/rest/v1/companies')).toBe(false);
  });

  it('says the figures could not be read, never that nothing is waiting', async () => {
    server.on('POST /rest/v1/rpc/admin_overview', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.queryByText(ar.admin.needsAttention)).toBeNull();
  });

  it('says the deletion requests or the trend could not be read, with a retry, never leaving them out', async () => {
    server.on('GET /rest/v1/support_requests', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    server.on('POST /rest/v1/rpc/admin_trend', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin' });

    expect(await screen.findByText(ar.admin.deletionRequests)).toBeTruthy();
    expect(screen.getByText(ar.dashboard.trendActivityTitle)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: ar.common.retry })).toHaveLength(2);
    expect(screen.queryByText(ar.dashboard.trendPublished)).toBeNull();
  });
});

describe('deciding on a listing', () => {
  it('publishes it through the website, with the version the screen showed, and says so once the website has', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    // The whole text is in front of the moderator.
    expect(await screen.findByText(job.description_ar)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: `${ar.admin.approve}: مستشار مبيعات` }));
    expect(await screen.findByText(ar.admin.approveListingBody)).toBeTruthy();
    expect(shownToast()).toBeNull();

    const confirm = screen.getAllByRole('button', { name: ar.admin.approve }).at(-1)!;
    await act(async () => {
      fireEvent.press(confirm);
    });

    await waitFor(() => expect(actionsCalled('moderateJob')).toHaveLength(1));
    expect(actionsCalled('moderateJob')[0].body).toEqual({ input: { jobId: JOB_ID, action: 'approve', version: 4 } });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.approveListingTitle}`));
  });

  it('will not reject without a reason, and sends the reason it is given', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.admin.reject }));
    const field = await screen.findByLabelText(ar.admin.reasonToCompany);
    const confirm = () => screen.getAllByRole('button', { name: ar.admin.reject }).at(-1)!;
    expect(confirm().props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(field, 'يطلب فلوس من المتقدمين');
    await act(async () => {
      fireEvent.press(confirm());
    });
    await waitFor(() => expect(actionsCalled('moderateJob')).toHaveLength(1));
    expect(actionsCalled('moderateJob')[0].body).toEqual({
      input: { jobId: JOB_ID, action: 'reject', version: 4, reason: 'يطلب فلوس من المتقدمين' },
    });
  });

  it("keeps the sheet open with the website's sentence when somebody else decided first", async () => {
    server.on('POST /api/mobile/v1/actions/moderateJob', { ok: false, error: 'invalid_transition' });
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.approve}: مستشار مبيعات` }));
    await screen.findByText(ar.admin.approveListingBody);
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.approve }).at(-1)!);
    });

    expect(await screen.findByText(ar.admin.errors.invalid_transition)).toBeTruthy();
    expect(shownToast()).toBeNull();
  });

  it('says a lever the server held back for the authenticator, rather than that it failed', async () => {
    server.on('POST /api/mobile/v1/actions/moderateJob', { ok: false, error: 'mfa_required' });
    server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: false }));
    await signIn({ aal: 'aal1', factor: false });
    await renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.approve}: مستشار مبيعات` }));
    await screen.findByText(ar.admin.approveListingBody);
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.approve }).at(-1)!);
    });
    expect(await screen.findByText(ar.app.admin.door.mfa_required)).toBeTruthy();
  });
});

describe('a decision that did not go through', () => {
  it('claims nothing after the server failed, and reads the queue again', async () => {
    server.on('POST /api/mobile/v1/actions/moderateJob', { status: 502, body: { error: 'bad_gateway' } });
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.approve}: مستشار مبيعات` }));
    await screen.findByText(ar.admin.approveListingBody);
    server.requests.length = 0;
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.approve }).at(-1)!);
    });

    // The action may have run: the network sentence, not "nothing was changed".
    expect(await screen.findByText(ar.admin.errors.network)).toBeTruthy();
    expect(screen.queryByText(ar.admin.errors.unknown)).toBeNull();
    expect(shownToast()).toBeNull();
    await waitFor(() => expect(server.requests.some((request) => request.url.pathname === '/rest/v1/jobs')).toBe(true));
  });

  it('cannot be swiped away while the website is still deciding', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/moderateJob', () => new Promise((resolve) => (answer = resolve)));
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/jobs/${JOB_ID}` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.approve}: مستشار مبيعات` }));
    await screen.findByText(ar.admin.approveListingBody);
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.approve }).at(-1)!);
    });
    await waitFor(() => expect(actionsCalled('moderateJob')).toHaveLength(1));

    const sheet = screen.UNSAFE_getAllByType(Modal).find((modal) => modal.props.visible);
    expect(sheet).toBeTruthy();
    act(() => {
      sheet!.props.onRequestClose();
    });
    expect(screen.getByText(ar.admin.approveListingBody)).toBeTruthy();

    await act(async () => {
      answer({ ok: true });
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.approveListingTitle}`));
  });
});

describe('the other queues', () => {
  it('keeps a case under investigation in the under-review queue, with its levers', async () => {
    const investigated = { ...reportCase, open_reports: 0, investigating_reports: 2 };
    server.on('POST /rest/v1/rpc/admin_report_cases', (_url: URL, init?: RequestInit) =>
      JSON.parse(String(init?.body ?? '{}')).p_view === 'under_review' ? [investigated] : [],
    );
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText(ar.admin.emptyQueue)).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: ar.admin.reportView.under_review }));
    expect(await screen.findByText(reportRow.detail as string)).toBeTruthy();
    // Nothing left to take: no Investigate — the decisions are still here.
    expect(screen.queryByRole('button', { name: ar.admin.investigate })).toBeNull();
    expect(screen.getByRole('button', { name: ar.admin.resolveTakeDownJob })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.admin.resolveOnly })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.admin.dismissReports })).toBeTruthy();
  });

  it('reads only the reports it draws, never more than the database takes', async () => {
    const pile = { ...reportCase, reports: 600, reporters: 600, report_ids: Array.from({ length: 600 }, (_, i) => `r${i}`) };
    server.on('POST /rest/v1/rpc/admin_report_cases', [pile]);
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText(reportRow.detail as string)).toBeTruthy();
    const asked = server.requests.find((request) => request.url.pathname === '/rest/v1/rpc/admin_report_rows');
    expect((asked?.body as { p_ids: string[] }).p_ids).toHaveLength(3);
    // The count, isolated left to right inside the Arabic sentence.
    expect(screen.getByText(/600.*بلاغ/)).toBeTruthy();
  });

  it('takes a reported listing down and resolves its reports in one step, with the reason', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText(reportRow.detail as string)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.admin.resolveTakeDownJob }));
    fireEvent.changeText(await screen.findByLabelText(ar.admin.reasonToCompany), 'نصب على المتقدمين');
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.resolveTakeDownJob }).at(-1)!);
    });

    await waitFor(() => expect(actionsCalled('moderateReports')).toHaveLength(1));
    expect(actionsCalled('moderateReports')[0].body).toEqual({
      input: { targetType: 'job', targetId: JOB_ID, status: 'resolved', takeAction: true, note: 'نصب على المتقدمين' },
    });
  });

  it('approves an account waiting for it', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/users' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.approveAccount}: أحمد سمير` }));
    await screen.findByText(ar.admin.approveAccountBody);
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.approveAccount }).at(-1)!);
    });
    await waitFor(() => expect(actionsCalled('setAccountApproval')).toHaveLength(1));
    expect(actionsCalled('setAccountApproval')[0].body).toEqual({ input: { userId: OTHER_USER, status: 'approved' } });
  });

  it("lists the companies whose papers wait, oldest first, and opens one's page where its papers and levers are", async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin/companies' });

    expect(await screen.findByText(company.name_ar)).toBeTruthy();
    // The website's own query for its verification queue: pending, with pending papers, the longest wait first.
    const asked = server.asked('/rest/v1/companies').at(-1)!.url.searchParams;
    expect(asked.get('verification_status')).toBe('eq.pending');
    expect(asked.get('company_documents.status')).toBe('eq.pending');
    expect(asked.get('order')).toBe('created_at.asc,id.asc');
    expect(asked.get('select')).toContain('company_documents!inner(id)');
    expect(screen.getByText(`${ar.admin.colListings}: 3 · ${ar.admin.colMembers}: 1`)).toBeTruthy();

    // The papers, the people, the listings and every lever are on the company's own page (admin-companies.test.tsx).
    fireEvent.press(screen.getByRole('link', { name: company.name_ar }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/companies/${company.id}`));
  });
});
