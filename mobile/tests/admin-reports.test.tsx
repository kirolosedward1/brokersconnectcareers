import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { cairoDayStart } from '@/lib/admin/params';
import type { AdminReportCase, AdminReportDetail, ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as ReportsScreen from '../src/app/(tabs)/(admin)/admin/reports/index';
import { DeclaredTabs } from './declared-tabs';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { company } from './fixtures';
import { fakeServer } from './server';

/*
  The reports screen — the website's /admin/reports, every view and filter —
  as the real screen draws it against stand-ins for Supabase and the website:
  what each view and filter asks the database for (the exact arguments of
  admin_report_cases and admin_report_rows), the pages, what a report line
  says about its reporter, which levers a case offers in which state, and the
  exact request each lever makes through the website's own action.
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
const GONE_JOB = '5b0c7d1e-0000-4000-8000-000000000302';
const COMPANY_TARGET = '6c0c7d1e-0000-4000-8000-000000000401';
const REPORTER = '8b7c7f1e-0000-4000-8000-000000000099';
const R1 = 'a1000000-0000-4000-8000-000000000001';
const R2 = 'a1000000-0000-4000-8000-000000000002';
const R3 = 'a1000000-0000-4000-8000-000000000003';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const liveCase: AdminReportCase = {
  target_type: 'job',
  target_id: JOB_ID,
  label_ar: 'مستشار مبيعات',
  label_en: null,
  company_id: company.id,
  company_name_ar: company.name_ar,
  company_name_en: null,
  target_state: 'active',
  reports: 1,
  reporters: 1,
  open_reports: 1,
  investigating_reports: 0,
  system_flags: 0,
  max_severity: 3,
  reasons: ['scam'],
  first_at: '2026-10-18T10:00:00Z',
  last_at: '2026-10-20T10:00:00Z',
  fresh_reporters: 1,
  noisy_reporters: 0,
  employer_reporters: 0,
  report_ids: [R1],
  total_count: 2,
};

const deletedCase: AdminReportCase = {
  ...liveCase,
  target_id: GONE_JOB,
  label_ar: 'إعلان اتمسح',
  target_state: 'deleted',
  reports: 2,
  reporters: 2,
  open_reports: 1,
  investigating_reports: 1,
  max_severity: 2,
  reasons: ['spam', 'duplicate'],
  fresh_reporters: 0,
  report_ids: [R2, R3],
};

const companyCase: AdminReportCase = {
  ...liveCase,
  target_type: 'company',
  target_id: COMPANY_TARGET,
  label_ar: 'شركة النيل',
  company_id: COMPANY_TARGET,
  target_state: 'listed',
  reasons: ['suspicious_company'],
  report_ids: [R1],
  total_count: 1,
};

const report = (over: Partial<AdminReportDetail>): AdminReportDetail => ({
  id: R1,
  target_type: 'job',
  target_id: JOB_ID,
  target_live: true,
  reason: 'scam',
  severity: 3,
  detail: 'طلبوا مالًا قبل المقابلة.',
  status: 'open',
  source: 'user',
  abusive: false,
  created_at: '2026-10-20T10:00:00Z',
  resolved_at: null,
  target_snapshot: { label_ar: 'مستشار مبيعات', excerpt: 'ادفع ٥٠٠ جنيه رسوم تدريب قبل البدء.' },
  reporter_id: REPORTER,
  reporter_name: 'منى علي',
  reporter_role: 'candidate',
  // Signed up three days before reporting: an account under a week old.
  reporter_since: '2026-10-17T10:00:00Z',
  reporter_company_ar: null,
  reporter_company_en: null,
  reporter_filed: 4,
  reporter_dismissed: 2,
  reporter_abusive: 1,
  reporter_restricted: true,
  total_count: 1,
  ...over,
});

const openReport = report({});
const platformReport = report({ id: R2, target_id: GONE_JOB, target_live: false, reason: 'spam', severity: 1, source: 'system', reporter_id: null, reporter_name: null, detail: null });
const investigatedReport = report({
  id: R3,
  target_id: GONE_JOB,
  target_live: false,
  reason: 'duplicate',
  severity: 1,
  status: 'investigating',
  detail: 'الإعلان نفسه مكرر.',
  reporter_id: '8b7c7f1e-0000-4000-8000-000000000098',
  reporter_name: 'سامي حسن',
  reporter_since: '2026-01-01T10:00:00Z',
  reporter_filed: 1,
  reporter_dismissed: 0,
  reporter_abusive: 0,
  reporter_restricted: false,
});
const resolvedReport = report({
  status: 'resolved',
  resolved_at: '2026-10-21T10:00:00Z',
  reporter_since: '2026-01-01T10:00:00Z',
  reporter_restricted: false,
  total_count: 1,
});

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
  server.on('POST /rest/v1/rpc/admin_report_cases', (_url: URL, init?: RequestInit) =>
    JSON.parse(String(init?.body ?? '{}')).p_view === 'new' ? [liveCase, deletedCase] : [],
  );
  server.on('POST /rest/v1/rpc/admin_report_rows', (_url: URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { p_ids?: string[]; p_status?: string };
    if (body.p_ids) return [openReport, platformReport, investigatedReport].filter((row) => body.p_ids?.includes(row.id));
    return body.p_status === 'resolved' ? [resolvedReport] : [];
  });
  server.on('POST /rest/v1/rpc/admin_job_signals', [
    {
      job_id: JOB_ID,
      flags: [{ flag: 'asks_for_money', weight: 'high', evidence: '٥٠٠ جنيه رسوم' }],
      company_id: company.id,
      company_signals: { signals: [{ signal: 'rejections', count: 3 }], facts: {} },
    },
  ]);
  server.on('POST /rest/v1/rpc/admin_company_signals', [
    {
      company_id: COMPANY_TARGET,
      flags: [],
      signals: { signals: [{ signal: 'shared_phone', companies: [{ id: company.id, name_ar: company.name_ar, name_en: null, suspended: true }] }], facts: {} },
    },
  ]);
  server.on('POST /api/mobile/v1/actions/moderateReports', { ok: true, data: { moved: 1 } });
  server.on('POST /api/mobile/v1/actions/closeReports', { ok: true, data: { moved: 1 } });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
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
  '(tabs)/(admin)/admin/reports/index': ReportsScreen,
  '(tabs)/(admin)/admin/jobs/[id]': stand('the listing'),
  '(tabs)/(admin)/admin/users/[id]': stand('the account'),
  // The company's and the consultant's pages are the console's own screens (items 4 and 5): stood in for here.
  '(tabs)/(admin)/admin/companies/[id]': stand('the company'),
  '(tabs)/(admin)/admin/agents/[id]': stand('the consultant'),
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** What the screen last asked a database function for. */
function lastAsked(fn: string) {
  return server.asked(`/rest/v1/rpc/${fn}`).at(-1)?.body as Record<string, unknown> | undefined;
}

/** The sheet's own confirm button: the last one with the lever's label, after the one on the screen that opened it. */
function confirmButton(label: string) {
  return screen.getAllByRole('button', { name: label }).at(-1)!;
}

/** Every argument the website's page sends when nothing is filtered. */
const NO_FILTER = { p_type: null, p_reason: null, p_min_severity: null, p_from: null, p_to: null };

describe('the views', () => {
  it('asks for new cases the way the website does, twenty a page, and under review the same', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText(`«${openReport.detail}»`)).toBeTruthy();
    expect(lastAsked('admin_report_cases')).toEqual({ p_view: 'new', ...NO_FILTER, p_min_reporters: null, p_limit: 20, p_offset: 0 });
    // Only the reports drawn are read, and signals only for targets that still exist.
    expect(lastAsked('admin_report_rows')).toEqual({ p_ids: [R1, R2, R3] });
    expect(lastAsked('admin_job_signals')).toEqual({ p_jobs: [JOB_ID] });
    expect(server.asked('/rest/v1/rpc/admin_company_signals')).toHaveLength(0);

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.reportView.under_review }));
    await waitFor(() => expect(lastAsked('admin_report_cases')).toMatchObject({ p_view: 'under_review', p_offset: 0 }));
    expect(await screen.findByText(ar.admin.emptyQueue)).toBeTruthy();
  });

  it('draws the closed reports themselves, thirty a page, with no lever on them', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.reportView.resolved }));
    expect(await screen.findByText('21 أكتوبر 2026', { exact: false })).toBeTruthy();
    expect(lastAsked('admin_report_rows')).toEqual({ p_status: 'resolved', ...NO_FILTER, p_limit: 30, p_offset: 0 });
    expect(server.asked('/rest/v1/rpc/admin_report_cases')).toHaveLength(1);
    expect(screen.getByText(`«${openReport.detail}»`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.admin.investigate })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.admin.resolveOnly })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`^${ar.admin.dismissAbusive}`) })).toBeNull();

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.reportView.dismissed }));
    await waitFor(() => expect(lastAsked('admin_report_rows')).toMatchObject({ p_status: 'dismissed', p_limit: 30, p_offset: 0 }));
    expect(await screen.findByText(ar.admin.emptyQueue)).toBeTruthy();
  });

  it('asks for the next page from where the last ended, in each kind of view', async () => {
    const cases = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...liveCase,
        target_id: `00000000-0000-4000-8000-${String(offset + i).padStart(12, '0')}`,
        label_ar: `حالة ${offset + i}`,
        report_ids: [],
        total_count: 25,
      }));
    server.on('POST /rest/v1/rpc/admin_report_cases', (_url: URL, init?: RequestInit) => {
      const offset = Number(JSON.parse(String(init?.body)).p_offset);
      return offset === 0 ? cases(0, 20) : cases(20, 5);
    });
    server.on('POST /rest/v1/rpc/admin_report_rows', (_url: URL, init?: RequestInit) => {
      const offset = Number(JSON.parse(String(init?.body)).p_offset);
      const rows = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({ ...resolvedReport, id: `b1000000-0000-4000-8000-${String(from + i).padStart(12, '0')}`, total_count: 31 }));
      return offset === 0 ? rows(0, 30) : rows(30, 1);
    });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText('حالة 0')).toBeTruthy();
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(lastAsked('admin_report_cases')).toMatchObject({ p_limit: 20, p_offset: 20 }));
    // Twenty-five of twenty-five: the end is the end.
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    expect(server.asked('/rest/v1/rpc/admin_report_cases')).toHaveLength(2);

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.reportView.resolved }));
    await waitFor(() => expect(lastAsked('admin_report_rows')).toMatchObject({ p_status: 'resolved', p_offset: 0 }));
    await screen.findAllByText('21 أكتوبر 2026', { exact: false });
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(lastAsked('admin_report_rows')).toMatchObject({ p_status: 'resolved', p_limit: 30, p_offset: 30 }));
  });

  it('says a failed read failed, with a retry — never that nothing is waiting', async () => {
    server.on('POST /rest/v1/rpc/admin_report_cases', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();

    server.on('POST /rest/v1/rpc/admin_report_cases', [liveCase]);
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(`«${openReport.detail}»`)).toBeTruthy();
  });
});

describe('the filters', () => {
  it('sends the kind, the reason, the severity, the Cairo days and the repeat exactly as the website does', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.kind.job }));
    await waitFor(() => expect(lastAsked('admin_report_cases')).toMatchObject({ p_view: 'new', p_type: 'job', p_offset: 0 }));

    fireEvent.press(screen.getByRole('button', { name: ar.admin.filtersLabel }));
    fireEvent.press(await screen.findByRole('radio', { name: ar.reportReason.scam }));
    fireEvent.press(screen.getByRole('radio', { name: ar.admin.severityMediumUp }));
    fireEvent.changeText(screen.getByLabelText(ar.admin.filterFrom), '2026-10-01');
    // Digits as an Arabic keyboard types them are read the same.
    fireEvent.changeText(screen.getByLabelText(ar.admin.filterTo), '٢٠٢٦-١٠-٢٠');
    fireEvent.press(screen.getByRole('switch', { name: ar.admin.filterRepeat }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: ar.admin.applyFilters }));
    });

    await waitFor(() =>
      expect(lastAsked('admin_report_cases')).toEqual({
        p_view: 'new',
        p_type: 'job',
        p_reason: 'scam',
        p_min_severity: 2,
        // The day a moderator means begins in Cairo; the end of the range is the day after, exclusive.
        p_from: cairoDayStart('2026-10-01'),
        p_to: cairoDayStart('2026-10-20', 1),
        p_min_reporters: 2,
        p_limit: 20,
        p_offset: 0,
      }),
    );
    expect(cairoDayStart('2026-10-01')).toMatch(/^2026-09-30T2[12]:00:00\.000Z$/);

    // Each filter set is a chip that takes it off again.
    fireEvent.press(screen.getByRole('button', { name: ar.jobs.removeFilter.replace('{name}', ar.reportReason.scam) }));
    await waitFor(() => expect(lastAsked('admin_report_cases')).toMatchObject({ p_reason: null, p_min_severity: 2, p_min_reporters: 2 }));
  });

  it('refuses a day that is not one, and applies nothing', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    fireEvent.press(screen.getByRole('button', { name: ar.admin.filtersLabel }));
    fireEvent.changeText(await screen.findByLabelText(ar.admin.filterFrom), '2026-02-30');
    fireEvent.press(screen.getByRole('button', { name: ar.admin.applyFilters }));
    expect(await screen.findByText(ar.app.admin.reports.dayInvalid)).toBeTruthy();
    expect(server.asked('/rest/v1/rpc/admin_report_cases')).toHaveLength(1);
  });

  it("opens the view and filters a website link names, the repeat counting on the open views only", async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports?status=resolved&type=company&reason=scam&severity=3&from=2026-10-01&to=2026-10-20&repeat=1' });

    await waitFor(() =>
      expect(lastAsked('admin_report_rows')).toEqual({
        p_status: 'resolved',
        p_type: 'company',
        p_reason: 'scam',
        p_min_severity: 3,
        p_from: cairoDayStart('2026-10-01'),
        p_to: cairoDayStart('2026-10-20', 1),
        p_limit: 30,
        p_offset: 0,
      }),
    );
    expect(screen.getByRole('radio', { name: ar.admin.reportView.resolved }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('radio', { name: ar.admin.kind.company }).props.accessibilityState).toMatchObject({ checked: true });
    expect(server.asked('/rest/v1/rpc/admin_report_cases')).toHaveLength(0);

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.reportView.under_review }));
    await waitFor(() => expect(lastAsked('admin_report_cases')).toMatchObject({ p_view: 'under_review', p_type: 'company', p_min_reporters: 2 }));
  });

  it('holds a link to the views and values the website has', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports?status=whatever&type=user&reason=nope&severity=9&from=2026-02-30' });

    await waitFor(() => expect(lastAsked('admin_report_cases')).toEqual({ p_view: 'new', ...NO_FILTER, p_min_reporters: null, p_limit: 20, p_offset: 0 }));
  });
});

describe('a report line', () => {
  it("says who sent it, their record, and what colours it — and marks the platform's own flags", async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText(`«${openReport.detail}»`)).toBeTruthy();
    expect(screen.getByText(ar.admin.reporterRecord.replace('{filed}', '4').replace('{dismissed}', '2').replace('{abusive}', '1'))).toBeTruthy();
    expect(screen.getByText(ar.admin.reporterNewAccount)).toBeTruthy();
    expect(screen.getByText(ar.admin.reporterBanned)).toBeTruthy();
    expect(screen.getByText(ar.admin.freshReporters.replace('{count}', '1'))).toBeTruthy();
    expect(screen.getByText(ar.admin.systemFlag, { exact: false })).toBeTruthy();
    expect(screen.getByText(ar.admin.reportStatus.investigating)).toBeTruthy();
    // The listing's own words, and its company's record, beside the case.
    expect(screen.getByText(ar.admin.flag.asks_for_money, { exact: false })).toBeTruthy();
    expect(screen.getByText(ar.admin.signal.rejections.replace('{count}', '3'))).toBeTruthy();
  });

  it("dismisses one report as filed in bad faith, only with a reason, and only a person's open report", async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    // The person's open report and the one under investigation offer it; the platform's flag does not.
    expect(screen.getAllByRole('button', { name: new RegExp(`^${ar.admin.dismissAbusive}`) })).toHaveLength(2);
    fireEvent.press(screen.getByRole('button', { name: `${ar.admin.dismissAbusive}: منى علي` }));
    expect(await screen.findByText(ar.admin.dismissAbusiveBody)).toBeTruthy();
    const field = screen.getByLabelText(ar.admin.abusiveReasonLabel);
    expect(confirmButton(ar.admin.dismissAbusive).props.accessibilityState?.disabled).toBe(false);

    fireEvent.changeText(field, 'بيبلّغ عن كل إعلان منافس');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.dismissAbusive));
    });
    await waitFor(() => expect(actionsCalled('closeReports')).toHaveLength(1));
    expect(actionsCalled('closeReports')[0].body).toEqual({
      input: { ids: [R1], status: 'dismissed', abusive: true, note: 'بيبلّغ عن كل إعلان منافس' },
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.dismissAbusive}`));
  });

  it('opens the reporter\'s file', async () => {
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    fireEvent.press(screen.getByText('منى علي'));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/users/${REPORTER}`));
  });
});

describe('a case whose target was deleted', () => {
  it('shows what it said when reported, and can only be closed — all its open reports at once, the note optional', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    expect(screen.getByText(ar.admin.snapshotLabel)).toBeTruthy();
    expect(screen.getByText('ادفع ٥٠٠ جنيه رسوم تدريب قبل البدء.')).toBeTruthy();
    expect(screen.getByText(ar.admin.stateDeleted)).toBeTruthy();
    // One live case, one deleted: the take-down levers once, the close-only levers once.
    expect(screen.getAllByRole('button', { name: ar.admin.investigate })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: ar.admin.resolveTakeDownJob })).toHaveLength(1);
    expect(screen.getByRole('button', { name: ar.admin.closeDeletedResolve })).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.admin.closeDeletedDismiss })).toBeTruthy();

    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/closeReports', () => new Promise((resolve) => (answer = resolve)));
    fireEvent.press(screen.getByRole('button', { name: ar.admin.closeDeletedResolve }));
    expect(await screen.findByText(ar.admin.closeDeletedBody)).toBeTruthy();
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.closeDeletedResolve));
    });
    await waitFor(() => expect(actionsCalled('closeReports')).toHaveLength(1));
    expect(actionsCalled('closeReports')[0].body).toEqual({ input: { ids: [R2, R3], status: 'resolved', abusive: false } });
    // Asked, not yet answered: nothing is said to be done.
    expect(shownToast()).toBeNull();
    await act(async () => {
      answer({ ok: true, data: { moved: 2 } });
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.closeDeletedResolve}`));
  });

  it('closes them as no breach the same way', async () => {
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    fireEvent.press(screen.getByRole('button', { name: ar.admin.closeDeletedDismiss }));
    await screen.findByText(ar.admin.closeDeletedBody);
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.closeDeletedDismiss));
    });
    await waitFor(() => expect(actionsCalled('closeReports')).toHaveLength(1));
    expect(actionsCalled('closeReports')[0].body).toEqual({ input: { ids: [R2, R3], status: 'dismissed', abusive: false } });
  });

  it("keeps the sheet open with the website's sentence when the website refuses", async () => {
    server.on('POST /api/mobile/v1/actions/closeReports', { ok: false, error: 'not_found' });
    await signIn();
    await renderRouter(app, { initialUrl: '/admin/reports' });
    await screen.findByText(`«${openReport.detail}»`);

    fireEvent.press(screen.getByRole('button', { name: ar.admin.closeDeletedResolve }));
    await screen.findByText(ar.admin.closeDeletedBody);
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.closeDeletedResolve));
    });
    expect(await screen.findByText(ar.admin.errors.not_found)).toBeTruthy();
    expect(shownToast()).toBeNull();
  });
});

describe('a reported company', () => {
  it("draws its signals, offers its suspension, and opens the company's page", async () => {
    server.on('POST /rest/v1/rpc/admin_report_cases', (_url: URL, init?: RequestInit) =>
      JSON.parse(String(init?.body ?? '{}')).p_view === 'new' ? [companyCase] : [],
    );
    await signIn();
    const result = await renderRouter(app, { initialUrl: '/admin/reports' });

    expect(await screen.findByText('شركة النيل')).toBeTruthy();
    expect(lastAsked('admin_company_signals')).toEqual({ p_companies: [COMPANY_TARGET] });
    expect(server.asked('/rest/v1/rpc/admin_job_signals')).toHaveLength(0);
    expect(screen.getByText(ar.admin.signal.shared_phone, { exact: false })).toBeTruthy();
    expect(screen.getByText(company.name_ar)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.admin.resolveSuspendCompany })).toBeTruthy();

    fireEvent.press(screen.getByText('شركة النيل'));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/companies/${COMPANY_TARGET}`));
  });
});
