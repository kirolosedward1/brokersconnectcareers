import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as CompaniesScreen from '../src/app/(tabs)/(admin)/admin/companies/index';
import * as CompanyScreen from '../src/app/(tabs)/(admin)/admin/companies/[id]';
import { DeclaredTabs } from './declared-tabs';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { company } from './fixtures';
import { fakeServer } from './server';

/*
  The companies half of the console in the app — the website's
  /admin/companies in every one of its views, and one company's page — as the
  real screens draw them against stand-ins for Supabase and the website: each
  view's exact query, the search, the paging; and on the page, the papers
  opened through a link made per tap, the people and the listings a tap from
  their files, and every lever the website offers in the state it offers it,
  each through the website's own action with the reason typed, and "done"
  only once the website said so.
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

/** A row of the list, as the website's select shapes it. */
const row = {
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
};

/** The company as its page reads it: papers under review, version 2. */
const pendingCompany = {
  ...company,
  verification_status: 'pending',
  verified_at: null,
  suspended_at: null,
  version: 2,
  district: { name_ar: 'القاهرة الجديدة', name_en: 'New Cairo' },
};

const paper = { id: DOC_ID, doc_type: 'commercial_register', status: 'pending', review_note: null, created_at: '2026-10-20T10:00:00Z' };

let me: ProfileRow;
let one: Record<string, unknown>;
let papers: (typeof paper)[];

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  one = { ...pendingCompany };
  papers = [paper];
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  // The list (a page, with its total) or the one company the page asked for.
  server.on('GET /rest/v1/companies', (url: URL) =>
    url.searchParams.get('id')?.startsWith('eq.') ? [one] : { body: [row], headers: { 'content-range': '0-0/1' } },
  );
  server.on('GET /rest/v1/company_documents', () => papers);
  server.on('POST /rest/v1/rpc/admin_view_contacts', [
    { user_id: company.owner_id, email: 'owner@demo.test', whatsapp_phone: '+201012345671', email_confirmed: true },
    { user_id: OTHER_USER, email: 'mona@demo.test', whatsapp_phone: '+201012345672', email_confirmed: false },
  ]);
  server.on('GET /rest/v1/company_members', [
    { role: 'admin', created_at: '2026-07-01T10:00:00Z', profile: { id: company.owner_id, full_name: 'أحمد سمير', approval_status: 'approved' } },
    { role: 'recruiter', created_at: '2026-08-01T10:00:00Z', profile: { id: OTHER_USER, full_name: 'منى علي', approval_status: 'pending' } },
  ]);
  server.on('GET /rest/v1/jobs', {
    body: [
      {
        id: JOB_ID,
        title_ar: 'مستشار مبيعات',
        title_en: null,
        status: 'active',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        created_at: '2026-10-09T10:00:00Z',
        applications: [{ count: 4 }],
      },
    ],
    headers: { 'content-range': '0-0/7' },
  });
  server.on('GET /rest/v1/reports', [
    { id: 'r1', reason: 'suspicious_company', detail: 'العنوان غير موجود.', status: 'open', created_at: '2026-10-20T10:00:00Z', reporter: { id: OTHER_USER, full_name: 'منى علي' } },
  ]);
  server.on('HEAD /rest/v1/reports', { body: null, headers: { 'content-range': '*/2' } });
  server.on('GET /rest/v1/company_moderation', () => []);
  server.on('POST /rest/v1/rpc/admin_company_signals', () => [
    { company_id: company.id, flags: [{ flag: 'whatsapp_link', weight: 'low' }], signals: { signals: [{ signal: 'duplicate_listings', count: 3 }], facts: {} } },
  ]);
  server.on('GET /rest/v1/admin_audit_log', []);
  server.on('GET /rest/v1/moderation_notes', []);
  server.on('POST /api/mobile/v1/actions/reviewCompany', { ok: true });
  server.on('POST /api/mobile/v1/actions/setCompanySuspension', { ok: true, data: { takenDown: 2 } });
  server.on('POST /api/mobile/v1/actions/getDocumentUrl', { ok: true, data: { url: 'https://storage.example/doc?token=abc' } });
  server.on('POST /api/mobile/v1/actions/addModerationNote', { ok: true });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
  jest.mocked(WebBrowser.openBrowserAsync).mockClear();
});

/** An admin, signed in with their authenticator's code (aal2). */
async function signIn() {
  const user = authUser({ factors: [totpFactor] });
  server.on('POST /auth/v1/token', () => authSession(user, 'aal2'));
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
  '(tabs)/(admin)/admin/index': stand('the overview'),
  '(tabs)/(admin)/admin/companies/index': CompaniesScreen,
  '(tabs)/(admin)/admin/companies/[id]': CompanyScreen,
  '(tabs)/(admin)/admin/jobs/index': stand('the listings'),
  '(tabs)/(admin)/admin/jobs/[id]': stand('a listing'),
  '(tabs)/(admin)/admin/users/[id]': stand('an account'),
  '(tabs)/(admin)/admin/reports/index': stand('the reports'),
  '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants,admin)/companies/[slug]': stand('the public page'),
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** What the list last asked the companies table for: its query string, which is the whole request. */
function lastAsked() {
  return server.asked('/rest/v1/companies').at(-1)!.url.searchParams;
}

/** The sheet's own confirm button: the last one with the lever's label, after the one on the screen that opened it. */
function confirmButton(label: string) {
  return screen.getAllByRole('button', { name: label }).at(-1)!;
}

const view = (name: string) => screen.getByRole('radio', { name });

describe('the companies', () => {
  it('draws every company first, and the verification queue oldest first, as the website asks for them', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/companies' });

    expect(await screen.findByText(company.name_ar)).toBeTruthy();
    // (postgrest-js sends the select without its spaces.)
    expect(lastAsked().get('select')).toBe(
      'id,name_ar,name_en,slug,logo_url,verification_status,suspended_at,created_at,jobs(count),company_members(count)',
    );
    expect(lastAsked().has('verification_status')).toBe(false);
    expect(lastAsked().has('company_documents.status')).toBe(false);
    expect(lastAsked().get('order')).toBe('created_at.desc,id.asc');
    expect(lastAsked().get('offset')).toBe('0');
    expect(lastAsked().get('limit')).toBe('25');
    expect(view(ar.admin.filterAll).props.accessibilityState).toMatchObject({ checked: true });

    fireEvent.press(view(ar.admin.verification.pending));
    await waitFor(() => expect(lastAsked().get('verification_status')).toBe('eq.pending'));
    expect(lastAsked().get('company_documents.status')).toBe('eq.pending');
    expect(lastAsked().get('order')).toBe('created_at.asc,id.asc');
    expect(lastAsked().get('select')).toContain('company_documents!inner(id)');
    // The website's columns: the listings and the people counted, the standing, when it joined.
    expect(await screen.findByText(`${ar.admin.colListings}: 3 · ${ar.admin.colMembers}: 1`)).toBeTruthy();
    // The view's chip, and the row's own badge.
    expect(screen.getAllByText(ar.admin.verification.pending)).toHaveLength(2);

    fireEvent.press(view(ar.admin.verification.verified));
    await waitFor(() => expect(lastAsked().get('verification_status')).toBe('eq.verified'));
    expect(lastAsked().get('order')).toBe('created_at.desc,id.asc');
    expect(lastAsked().has('company_documents.status')).toBe(false);
    expect(lastAsked().get('select')).not.toContain('company_documents');

    fireEvent.press(view(ar.admin.suspended));
    await waitFor(() => expect(lastAsked().get('suspended_at')).toBe('not.is.null'));
    expect(lastAsked().has('verification_status')).toBe(false);

    fireEvent.press(view(ar.admin.filterAll));
    await waitFor(() => expect(lastAsked().has('suspended_at')).toBe(false));
    expect(lastAsked().has('verification_status')).toBe(false);
    expect(lastAsked().get('order')).toBe('created_at.desc,id.asc');
  });

  it('searches both names and the slug with the loose Arabic pattern, and says when nothing matched', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/companies' });
    await screen.findByText(company.name_ar);

    const field = screen.getByLabelText(ar.filters.search);
    expect(field.props.placeholder).toBe(ar.admin.companiesSearchPlaceholder);
    fireEvent.changeText(field, ' أحمد ');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(lastAsked().get('or')).toBe('(name_ar.ilike.*_حمد*,name_en.ilike.*_حمد*,slug.ilike.*_حمد*)'));

    server.on('GET /rest/v1/companies', () => ({ body: [], headers: { 'content-range': '*/0' } }));
    fireEvent.changeText(field, 'nile');
    fireEvent(field, 'submitEditing');
    expect(await screen.findByText(ar.admin.searchNothing)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();
  });

  it('opens the view a website link names', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/companies?status=suspended' });

    expect(await screen.findByText(company.name_ar)).toBeTruthy();
    expect(lastAsked().get('suspended_at')).toBe('not.is.null');
    expect(view(ar.admin.suspended).props.accessibilityState).toMatchObject({ checked: true });
  });

  it('asks for the next twenty-five from where the last page ended, and stops at the total', async () => {
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ ...row, id: `00000000-0000-4000-8000-${String(offset + i).padStart(12, '0')}`, name_ar: `شركة ${offset + i}` }));
    server.on('GET /rest/v1/companies', (url: URL) => {
      const offset = Number(url.searchParams.get('offset'));
      return offset === 0
        ? { body: page(0, 25), headers: { 'content-range': '0-24/30' } }
        : { body: page(25, 5), headers: { 'content-range': '25-29/30' } };
    });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/companies?status=all' });

    expect(await screen.findByText('شركة 0')).toBeTruthy();
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(lastAsked().get('offset')).toBe('25'));
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    expect(server.asked('/rest/v1/companies')).toHaveLength(2);
  });

  it('says a failed read failed — never that nothing is waiting', async () => {
    server.on('GET /rest/v1/companies', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/companies' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();
  });
});

describe("a company's page", () => {
  it('shows its facts, its papers, its people, its listings, its reports and what to weigh, each a tap from its file', async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    // The name in the header, and again as the Arabic-name fact.
    expect(await screen.findAllByText(company.name_ar)).toHaveLength(2);
    expect(screen.getByText(company.slug)).toBeTruthy();
    expect(screen.getByText(ar.companyType.brokerage)).toBeTruthy();
    expect(screen.getByText('القاهرة الجديدة')).toBeTruthy();
    expect(screen.getByText(company.website as string)).toBeTruthy();
    // The paper, its standing, never its path.
    expect(screen.getByText(ar.employer.commercialRegister)).toBeTruthy();
    expect(server.asked('/rest/v1/company_documents').at(-1)!.url.searchParams.get('select')).toBe('id,doc_type,status,review_note,created_at');
    // The people: the owner marked, each one's standing.
    expect(screen.getByText(ar.admin.owner)).toBeTruthy();
    expect(screen.getByText(ar.admin.memberRole.recruiter)).toBeTruthy();
    expect(screen.getByText(/owner@demo\.test/)).toBeTruthy();
    expect(screen.getByText(/\+201012345672/)).toBeTruthy();
    // The listings: the twenty newest of every status, the exact total, and the open reports on them.
    expect(screen.getByText(ar.admin.listingsCount.replace('{count}', '7'))).toBeTruthy();
    expect(screen.getByText(/4 متقدمين/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /بلاغين مفتوحين/ })).toBeTruthy();
    const jobReports = server.requests.find((request) => request.method === 'HEAD' && request.url.pathname === '/rest/v1/reports')!;
    expect(jobReports.url.searchParams.get('job.company_id')).toBe(`eq.${company.id}`);
    expect(jobReports.url.searchParams.get('status')).toBe('in.(open,investigating)');
    // What to weigh: the company's own words, and its doings.
    expect(screen.getByText(ar.admin.flag.whatsapp_link, { exact: false })).toBeTruthy();
    expect(screen.getByText(/مكرر.*3/)).toBeTruthy();
    // The reports about it, each reporter a tap from their file.
    expect(screen.getByText('«العنوان غير موجود.»')).toBeTruthy();

    fireEvent.press(screen.getByRole('link', { name: 'مستشار مبيعات' }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/jobs/${JOB_ID}`));
  });

  it("opens a member's file", async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    fireEvent.press(await screen.findByRole('link', { name: 'أحمد سمير' }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/users/${company.owner_id}`));
  });

  it("opens a paper through a link made for that tap, and verifies the company with its version and an optional note", async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.viewDocument}: ${ar.employer.commercialRegister}` }));
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://storage.example/doc?token=abc'));
    expect(actionsCalled('getDocumentUrl')[0].body).toEqual({ input: { documentId: DOC_ID } });

    // Papers under review: verify, send back, or refuse; nothing to revoke.
    expect(screen.getByRole('button', { name: ar.admin.requestChanges })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.admin.reject })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.revokeVerification })).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: `${ar.admin.verify}: ${company.name_ar}` }));
    expect(await screen.findByText(ar.admin.verifyCompanyBody)).toBeTruthy();
    expect(screen.getByLabelText(ar.admin.reasonLabel)).toBeTruthy();
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.verify));
    });
    await waitFor(() => expect(actionsCalled('reviewCompany')).toHaveLength(1));
    expect(actionsCalled('reviewCompany')[0].body).toEqual({ input: { companyId: company.id, decision: 'verify', version: 2 } });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.verifyCompanyTitle.replace('{name}', company.name_ar)}`));
  });

  it('warns before verifying a company with no papers to go on, and will not send papers back that are not under review', async () => {
    one = { ...pendingCompany, verification_status: 'unverified' };
    papers = [];
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    expect(await screen.findByText(ar.admin.noDocuments)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.requestChanges })).toBeNull();
    expect(screen.getByRole('button', { name: ar.admin.reject })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: `${ar.admin.verify}: ${company.name_ar}` }));
    expect(await screen.findByText(ar.admin.verifyWithoutPapers)).toBeTruthy();
  });

  it('revokes a verified company for a reason kept on the record, with no version', async () => {
    one = { ...pendingCompany, verification_status: 'verified', verified_at: '2026-08-01T10:00:00Z' };
    papers = [{ ...paper, status: 'verified' }];
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    expect(await screen.findByRole('button', { name: ar.admin.revokeVerification })).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${ar.admin.verify}: ${company.name_ar}` })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.reject })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.requestChanges })).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: ar.admin.revokeVerification }));
    expect(await screen.findByText(ar.admin.revokeVerificationBody)).toBeTruthy();
    expect(confirmButton(ar.admin.revokeVerification).props.accessibilityState?.disabled).toBe(false);
    fireEvent.changeText(screen.getByLabelText(ar.admin.reasonLabel), 'الورق طلع مزوّر');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.revokeVerification));
    });
    await waitFor(() => expect(actionsCalled('reviewCompany')).toHaveLength(1));
    expect(actionsCalled('reviewCompany')[0].body).toEqual({ input: { companyId: company.id, decision: 'revoke', note: 'الورق طلع مزوّر' } });
  });

  it('suspends the company for a reason its members are sent, and says how many listings came down only once the website has', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/setCompanySuspension', () => new Promise((resolve) => (answer = resolve)));
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    expect(await screen.findByText(ar.admin.suspendCompanyHint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.restoreCompany })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: ar.admin.suspendCompany }));
    expect(await screen.findByText(ar.admin.suspendCompanyBody)).toBeTruthy();
    expect(confirmButton(ar.admin.suspendCompany).props.accessibilityState?.disabled).toBe(false);
    fireEvent.changeText(screen.getByLabelText(ar.admin.reasonToCompany), 'شركة وهمية');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.suspendCompany));
    });
    await waitFor(() => expect(actionsCalled('setCompanySuspension')).toHaveLength(1));
    expect(actionsCalled('setCompanySuspension')[0].body).toEqual({ input: { companyId: company.id, suspend: true, reason: 'شركة وهمية' } });
    expect(shownToast()).toBeNull();

    await act(async () => {
      answer({ ok: true, data: { takenDown: 2 } });
    });
    await waitFor(() => expect(shownToast()?.message).toContain(ar.admin.suspendCompanyTitle.replace('{name}', company.name_ar)));
    expect(shownToast()?.message).toMatch(/إعلانان/);
  });

  it('shows a suspended company its banner and reason, and lifts the suspension for a reason kept on the record', async () => {
    one = { ...pendingCompany, suspended_at: '2026-10-01T10:00:00Z' };
    server.on('GET /rest/v1/company_moderation', () => [{ suspension_reason: 'نصب على المتقدمين' }]);
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    expect(await screen.findByText(/نصب على المتقدمين/)).toBeTruthy();
    expect(screen.getByText(ar.admin.restoreCompanyHint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.suspendCompany })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: ar.admin.restoreCompany }));
    expect(await screen.findByText(ar.admin.restoreCompanyBody)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.admin.reasonLabel), 'اتأكدنا منهم');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.restoreCompany));
    });
    await waitFor(() => expect(actionsCalled('setCompanySuspension')).toHaveLength(1));
    expect(actionsCalled('setCompanySuspension')[0].body).toEqual({ input: { companyId: company.id, suspend: false, reason: 'اتأكدنا منهم' } });
    // Nothing comes back by itself: the plain confirmation, no count.
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.restoreCompany}`));
  });

  it("keeps the sheet open with the website's sentence when the website refuses, claiming nothing", async () => {
    server.on('POST /api/mobile/v1/actions/reviewCompany', { ok: false, error: 'stale_version' });
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.verify}: ${company.name_ar}` }));
    await screen.findByText(ar.admin.verifyCompanyBody);
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.verify));
    });
    expect(await screen.findByText(ar.admin.errors.stale_version)).toBeTruthy();
    expect(shownToast()).toBeNull();
  });

  it('adds a note to the record through the website', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    fireEvent.press(await screen.findByRole('button', { name: ar.app.admin.addNote }));
    fireEvent.changeText(await screen.findByLabelText(ar.app.admin.noteLabel), 'نتابعهم');
    await act(async () => {
      fireEvent.press(confirmButton(ar.app.admin.addNote));
    });
    await waitFor(() => expect(actionsCalled('addModerationNote')).toHaveLength(1));
    expect(actionsCalled('addModerationNote')[0].body).toEqual({ input: { targetType: 'company', targetId: company.id, body: 'نتابعهم' } });
  });

  it('says a page that could not be read failed, rather than drawing a company with nothing on it', async () => {
    server.on('GET /rest/v1/company_members', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    await renderRouter(app, { initialUrl: `/admin/companies/${company.id}` });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.noDocuments)).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.suspendCompany })).toBeNull();
  });
});
