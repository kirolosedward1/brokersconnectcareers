import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type {
  AbuseLimitRow,
  AuditLogRow,
  EmailActivityRow,
  EmailDeadLetterRow,
  JobRunRow,
  OutboxOverview,
  ProfileRow,
  ScheduledJobOverviewRow,
  SecurityEventRow,
  SecuritySummary,
} from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as EmailScreen from '../src/app/(tabs)/(admin)/admin/email/index';
import * as OperationsScreen from '../src/app/(tabs)/(admin)/admin/operations/index';
import * as SecurityScreen from '../src/app/(tabs)/(admin)/admin/security/index';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The read-mostly end of the console in the app — the website's /admin/email,
  /admin/operations and /admin/security — as the real screens draw them
  against stand-ins for Supabase and the website: the outbox and its states,
  the scheduled tasks in the website's spine order, the dead letters and the
  one lever on them (Retry, offered only where the website offers it, through
  the website's own action), the security strips and logs, and the mail-off
  banner every admin screen wears while mail is switched off.
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
const OTHER_USER = '8b7c7f1e-0000-4000-8000-000000000099';
const DEAD_RETRYABLE = 'ee000000-0000-4000-8000-000000000001';
const DEAD_FOREIGN = 'ee000000-0000-4000-8000-000000000002';
const DEAD_NO_ENTITY = 'ee000000-0000-4000-8000-000000000003';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const emailSummary = [
  { status: 'sent', count: 3 },
  { status: 'delivered', count: 12 },
  { status: 'failed', count: 2 },
];

const activity: EmailActivityRow[] = [
  {
    id: 'a1',
    template: 'application_receipt',
    recipient: 'mona@example.com',
    status: 'delivered',
    attempts: 1,
    entity_type: 'application',
    entity_id: 'ap000000-0000-4000-8000-000000000001',
    error: null,
    created_at: '2026-10-21T09:00:00Z',
    sent_at: '2026-10-21T09:00:05Z',
    delivered_at: '2026-10-21T09:00:09Z',
  },
  {
    id: 'a2',
    template: 'job_approved',
    recipient: 'ahmed@example.com',
    status: 'failed',
    attempts: 99,
    entity_type: 'job',
    entity_id: 'jb000000-0000-4000-8000-000000000001',
    error: 'Resend: 422 invalid recipient',
    created_at: '2026-10-20T09:00:00Z',
    sent_at: null,
    delivered_at: null,
  },
];

const dead: EmailDeadLetterRow[] = [
  {
    id: DEAD_RETRYABLE,
    template: 'job_approved',
    recipient: 'ahmed@example.com',
    attempts: 3,
    entity_type: 'job',
    entity_id: 'jb000000-0000-4000-8000-000000000001',
    error: 'Resend: 500',
    created_at: '2026-10-19T09:00:00Z',
    last_attempt_at: '2026-10-19T10:00:00Z',
    gave_up_at: '2026-10-19T10:00:00Z',
  },
  // A template the sweeper cannot rebuild: a retry would send nothing.
  {
    id: DEAD_FOREIGN,
    template: 'password_reset',
    recipient: 'sara@example.com',
    attempts: 3,
    entity_type: null,
    entity_id: 'ps000000-0000-4000-8000-000000000001',
    error: 'Resend: 500',
    created_at: '2026-10-18T09:00:00Z',
    last_attempt_at: '2026-10-18T10:00:00Z',
    gave_up_at: '2026-10-18T10:00:00Z',
  },
  // Retryable template, but nothing to rebuild it from.
  {
    id: DEAD_NO_ENTITY,
    template: 'welcome_candidate',
    recipient: 'omar@example.com',
    attempts: 3,
    entity_type: null,
    entity_id: null,
    error: 'Resend: 500',
    created_at: '2026-10-17T09:00:00Z',
    last_attempt_at: '2026-10-17T10:00:00Z',
    gave_up_at: '2026-10-17T10:00:00Z',
  },
];

/** Only one task has ever run, and it is not the first in the schedule. */
const jobOverview: ScheduledJobOverviewRow[] = [
  {
    job: 'daily-digest',
    last_started_at: '2026-10-22T06:00:00Z',
    last_status: 'succeeded',
    last_duration_ms: 1234,
    last_error: null,
    last_stats: { sent: 4 },
    last_success_at: '2026-10-22T06:00:01Z',
    failures_7d: 0,
    running: false,
  },
  { job: 'old-sweeper', last_started_at: '2026-09-01T06:00:00Z', last_status: 'failed', last_duration_ms: 50, last_error: 'boom', last_stats: null, last_success_at: null, failures_7d: 2, running: false },
];

const outbox: OutboxOverview = { due: 1, in_flight: 0, waiting: 4, dead: 3, oldest_due_at: '2026-10-22T07:00:00Z' };

const runs: JobRunRow[] = [
  {
    id: 'run1',
    job: 'daily-digest',
    status: 'succeeded',
    started_at: '2026-10-22T06:00:00Z',
    finished_at: '2026-10-22T06:00:01Z',
    lease_until: null,
    duration_ms: 1234,
    stats: { sent: 4, ms: 1234 },
    error: null,
  },
];

const securitySummary: SecuritySummary = {
  window_hours: 24,
  events_by_kind: [{ kind: 'auth.failed', count: 5 }],
  events_total: 5,
  events_warning: 1,
  events_critical: 0,
  reveals_24h: 7,
  reveals_top_viewers: [],
  rate_limited_24h: 2,
  uploads_rejected_24h: 0,
  auth_failures_24h: 3,
  accounts_suspended: 1,
  accounts_pending: 4,
  reports_open: 2,
  jobs_pending: 3,
  signups_24h: 6,
  applications_24h: 9,
};

const events: SecurityEventRow[] = [
  { id: 1, kind: 'auth.failed', severity: 'warning', actor_id: null, subject_hash: 'abcdef0123456789abcdef', metadata: {}, created_at: '2026-10-22T08:00:00Z' },
  { id: 2, kind: 'upload.rejected', severity: 'info', actor_id: OTHER_USER, subject_hash: null, metadata: {}, created_at: '2026-10-22T07:00:00Z' },
];

const auditRows: AuditLogRow[] = [
  { id: 1, actor_id: USER_ID, actor_role: 'admin', action: 'approval.set', target_type: 'profile', target_id: OTHER_USER, metadata: { from: 'pending', to: 'approved' }, created_at: '2026-10-22T08:30:00Z' },
];

const limits: AbuseLimitRow[] = [
  { key: 'contact_reveal:user:hour', window_seconds: 3600, max_hits: 30, note: null, updated_at: '2026-10-01T00:00:00Z' },
];

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
  server.on('GET /api/mobile/v1/admin/mail', { configured: true, missing: [] });
  server.on('POST /rest/v1/rpc/email_activity_summary', () => emailSummary);
  server.on('POST /rest/v1/rpc/email_activity', (_url: URL, init?: RequestInit) => {
    const status = JSON.parse(String(init?.body ?? '{}')).p_status as string | null;
    return status ? activity.filter((row) => row.status === status) : activity;
  });
  server.on('POST /rest/v1/rpc/scheduled_job_overview', () => jobOverview);
  server.on('POST /rest/v1/rpc/outbox_overview', () => [outbox]);
  server.on('POST /rest/v1/rpc/email_dead_letters', () => dead);
  server.on('POST /rest/v1/rpc/recent_job_runs', () => runs);
  server.on('POST /rest/v1/rpc/security_summary', () => securitySummary);
  server.on('GET /rest/v1/security_events', () => events);
  server.on('GET /rest/v1/audit_log', () => auditRows);
  server.on('GET /rest/v1/abuse_limits', () => limits);
  server.on('POST /api/mobile/v1/actions/requeueEmail', { ok: true });

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
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(admin)/admin/index': stand('the overview'),
  '(tabs)/(admin)/admin/email/index': EmailScreen,
  '(tabs)/(admin)/admin/operations/index': OperationsScreen,
  '(tabs)/(admin)/admin/security/index': SecurityScreen,
  '(tabs)/(admin)/admin/reports/index': stand('the reports'),
  '(tabs)/(admin)/admin/users/index': stand('the accounts'),
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** What the list last asked email_activity for. */
function lastActivityAsk() {
  return server.asked('/rest/v1/rpc/email_activity').at(-1)?.body as Record<string, unknown> | undefined;
}

describe('the email activity', () => {
  it('draws each state with its count, the messages with their recipients, and asks for one state at a time', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/email' });

    // Every message first: the website's 200, no state.
    expect(await screen.findByText('mona@example.com')).toBeTruthy();
    expect(screen.getByText('ahmed@example.com')).toBeTruthy();
    expect(lastActivityAsk()).toEqual({ p_limit: 200, p_status: null });
    // The chips, in the website's order, each with its thirty-day count; "all" is the sum.
    expect(screen.getByRole('radio', { name: `${ar.admin.emailAll}: 17` }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('radio', { name: `${ar.emailStatus.sent}: 3` })).toBeTruthy();
    expect(screen.getByRole('radio', { name: `${ar.emailStatus.delivered}: 12` })).toBeTruthy();
    expect(screen.getByRole('radio', { name: `${ar.emailStatus.failed}: 2` })).toBeTruthy();
    expect(screen.getByRole('radio', { name: `${ar.emailStatus.queued}: 0` })).toBeTruthy();
    const names = screen.getAllByRole('radio').map((chip) => (chip.props.accessibilityLabel as string).split(':')[0]);
    expect(names).toEqual([
      ar.admin.emailAll,
      ar.emailStatus.queued,
      ar.emailStatus.sent,
      ar.emailStatus.delivered,
      ar.emailStatus.bounced,
      ar.emailStatus.failed,
      ar.emailStatus.suppressed,
      ar.emailStatus.cancelled,
    ]);
    // What became of each: the state, the reason it failed, and attempts capped at the outbox's own five.
    expect(screen.getByText(ar.emailStatus.delivered)).toBeTruthy();
    expect(screen.getByText(`${ar.admin.emailError}: Resend: 422 invalid recipient`)).toBeTruthy();
    expect(screen.getByText('×5')).toBeTruthy();
    // No banner while mail is on.
    expect(screen.queryByText(ar.admin.emailOffTitle)).toBeNull();

    fireEvent.press(screen.getByRole('radio', { name: `${ar.emailStatus.failed}: 2` }));
    await waitFor(() => expect(lastActivityAsk()).toEqual({ p_limit: 200, p_status: 'failed' }));
    expect(await screen.findByText('ahmed@example.com')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('mona@example.com')).toBeNull());
  });

  it('opens the state a website link names, and says a read that failed as that — never "no messages yet"', async () => {
    server.on('POST /rest/v1/rpc/email_activity', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/email?status=failed' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emailEmpty)).toBeNull();
    expect(lastActivityAsk()).toEqual({ p_limit: 200, p_status: 'failed' });
    expect((await screen.findByRole('radio', { name: `${ar.emailStatus.failed}: 2` })).props.accessibilityState).toMatchObject({ checked: true });
  });
});

describe('the mail-off banner', () => {
  it('names the variables in the way while mail is switched off, on every admin screen', async () => {
    server.on('GET /api/mobile/v1/admin/mail', { configured: false, missing: ['RESEND_API_KEY', 'RESEND_FROM'] });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/email' });

    expect(await screen.findByText(ar.admin.emailOffTitle)).toBeTruthy();
    // The Resend credentials missing: messages are recorded but never sent.
    expect(screen.getByText(ar.admin.emailOffSending)).toBeTruthy();
    expect(screen.getByText('RESEND_API_KEY')).toBeTruthy();
    expect(screen.getByText('RESEND_FROM')).toBeTruthy();
    // Asked of the website, with the admin's token, never of the phone.
    const asked = server.asked('/api/mobile/v1/admin/mail');
    expect(asked).toHaveLength(1);

    act(() => router.navigate('/admin/security'));
    expect(await screen.findByText(ar.admin.securityLede)).toBeTruthy();
    expect(screen.getByText(ar.admin.emailOffTitle)).toBeTruthy();
  });

  it('says the outbox is not even recording when the service key is the one missing', async () => {
    server.on('GET /api/mobile/v1/admin/mail', { configured: false, missing: ['SUPABASE_SERVICE_ROLE_KEY'] });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/operations' });

    expect(await screen.findByText(ar.admin.emailOffOutbox)).toBeTruthy();
    expect(screen.getByText('SUPABASE_SERVICE_ROLE_KEY')).toBeTruthy();
  });

  it('says it could not find out, with a retry — never that mail is on', async () => {
    server.on('GET /api/mobile/v1/admin/mail', { status: 503, body: { error: 'unavailable' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/email' });

    expect(await screen.findByText(ar.app.admin.ops.mailUnknown)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emailOffTitle)).toBeNull();
    server.on('GET /api/mobile/v1/admin/mail', { configured: false, missing: ['RESEND_FROM'] });
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(ar.admin.emailOffTitle)).toBeTruthy();
  });
});

describe('the background work', () => {
  it('lists every scheduled task in schedule order, the ones that never ran said so, then the outbox, the dead letters and the runs', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/operations' });

    expect(await screen.findByText(ar.admin.opsJobsTitle)).toBeTruthy();
    // The spine, then what else the database knows of: the retired job is not hidden.
    const names = ['expire-jobs', 'email-retry', 'daily-digest', 'job-alerts', 'new-jobs', 'old-sweeper'];
    const drawn = screen.UNSAFE_root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((text): text is string => typeof text === 'string' && names.includes(text));
    // The task rows first, in that order; the one run recorded names its task again under the runs.
    expect(drawn).toEqual([...names, 'daily-digest']);
    // Four of the five expected tasks have never recorded a run — the most important thing the screen can show.
    expect(screen.getAllByText(ar.admin.opsNeverRun)).toHaveLength(4);
    expect(screen.getAllByText(ar.admin.opsStatus.succeeded).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('boom')).toBeTruthy();
    // The outbox's four figures and its oldest due message.
    expect(screen.getByLabelText(`${ar.admin.opsDue}: 1`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.opsWaiting}: 4`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.opsDead}: 3`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${ar.admin.opsOldestDue.split('{when}')[0]}`))).toBeTruthy();
    // The dead letters, each with its recipient and its attempts; the runs with their counts.
    expect(screen.getByText('sara@example.com')).toBeTruthy();
    expect(screen.getByText('omar@example.com')).toBeTruthy();
    expect(screen.getAllByText('×3')).toHaveLength(3);
    expect(screen.getByText(`${ar.admin.opsStats}: sent 4`)).toBeTruthy();
    // The asks, as the website makes them.
    expect(server.asked('/rest/v1/rpc/email_dead_letters').at(-1)?.body).toEqual({ p_limit: 100 });
    expect(server.asked('/rest/v1/rpc/recent_job_runs').at(-1)?.body).toEqual({ p_limit: 50 });
  });

  it('offers Retry only where a requeue can send something, and requeues through the website', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/operations' });

    expect(await screen.findByText('ahmed@example.com')).toBeTruthy();
    // One of three: the retryable template with an entity to rebuild from. Not
    // a template the sweeper cannot rebuild, nor one with nothing to rebuild.
    const retries = screen.getAllByRole('button', { name: new RegExp(`^${ar.admin.opsRetry}: `) });
    expect(retries.map((button) => button.props.accessibilityLabel)).toEqual([`${ar.admin.opsRetry}: ahmed@example.com`]);

    fireEvent.press(retries[0]);
    expect(await screen.findByText(ar.app.admin.ops.retryBody)).toBeTruthy();
    expect(screen.queryByLabelText(ar.admin.reasonLabel)).toBeNull();
    expect(shownToast()).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.opsRetry }).at(-1)!);
    });
    await waitFor(() => expect(actionsCalled('requeueEmail')).toHaveLength(1));
    expect(actionsCalled('requeueEmail')[0].body).toEqual({ input: { emailId: DEAD_RETRYABLE } });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.opsRetry}`));
  });

  it("keeps the sheet open with the website's sentence when the message cannot be rebuilt after all", async () => {
    server.on('POST /api/mobile/v1/actions/requeueEmail', { ok: false, error: 'not_retryable' });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/operations' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.opsRetry}: ahmed@example.com` }));
    await screen.findByText(ar.app.admin.ops.retryBody);
    await act(async () => {
      fireEvent.press(screen.getAllByRole('button', { name: ar.admin.opsRetry }).at(-1)!);
    });

    expect(await screen.findByText(ar.admin.errors.not_retryable)).toBeTruthy();
    expect(screen.getByText(ar.app.admin.ops.retryBody)).toBeTruthy();
    expect(shownToast()).toBeNull();
  });

  it('says nothing is given up on only when the read said so, and a failed read as that', async () => {
    server.on('POST /rest/v1/rpc/email_dead_letters', () => []);
    server.on('POST /rest/v1/rpc/recent_job_runs', () => []);
    await signIn();
    renderRouter(app, { initialUrl: '/admin/operations' });
    expect(await screen.findByText(ar.admin.opsDeadEmpty)).toBeTruthy();
    expect(screen.getByText(ar.admin.opsRunsEmpty)).toBeTruthy();

    server.on('POST /rest/v1/rpc/email_dead_letters', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/operations' });
    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.opsDeadEmpty)).toBeNull();
    expect(screen.queryByText(ar.admin.opsJobsTitle)).toBeNull();
  });
});

describe('the security page', () => {
  it("draws the website's two strips, the events, the audit trail and the limits, each figure with a list opening it", async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: '/admin/security' });

    expect(await screen.findByLabelText(`${ar.admin.secEvents}: 5`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secRateLimited}: 2`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secAuthFailures}: 3`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secUploadsRejected}: 0`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secReveals}: 7`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secSuspended}: 1`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secReportsOpen}: 2`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secJobsPending}: 3`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.admin.secSignups}: 6`)).toBeTruthy();
    // The events: their kind and the start of a hash or an id — nothing that names a visitor.
    expect(screen.getByText('auth.failed')).toBeTruthy();
    expect(screen.getByText('abcdef0123456789')).toBeTruthy();
    expect(screen.getByText('upload.rejected')).toBeTruthy();
    expect(screen.getByText(OTHER_USER.slice(0, 8))).toBeTruthy();
    expect(screen.getByText('warning')).toBeTruthy();
    // The audit trail: the action, the target with its move, the actor's role and id.
    expect(screen.getByText('approval.set')).toBeTruthy();
    expect(screen.getByText(`profile · ${OTHER_USER.slice(0, 8)} · pending → approved`)).toBeTruthy();
    expect(screen.getByText(`admin · ${USER_ID.slice(0, 8)}`)).toBeTruthy();
    // The limits, the window in minutes.
    expect(screen.getByText('contact_reveal:user:hour')).toBeTruthy();
    expect(screen.getByText(`${ar.admin.secLimitWindow}: 60 · ${ar.admin.secLimitMax}: 30`)).toBeTruthy();
    expect(screen.getByText(ar.admin.secLimitsHint)).toBeTruthy();
    // Latest fifty of each, newest first, read as the admin.
    const eventsAsk = server.asked('/rest/v1/security_events').at(-1)?.url.searchParams;
    expect(eventsAsk?.get('order')).toBe('created_at.desc');
    expect(eventsAsk?.get('limit')).toBe('50');
    const auditAsk = server.asked('/rest/v1/audit_log').at(-1)?.url.searchParams;
    expect(auditAsk?.get('order')).toBe('created_at.desc');
    expect(auditAsk?.get('limit')).toBe('50');
    // Nothing is written from here.
    expect(server.requests.some((request) => request.url.pathname === '/rest/v1/abuse_limits' && request.method !== 'GET')).toBe(false);

    fireEvent.press(screen.getByLabelText(`${ar.admin.secReportsOpen}: 2`));
    await waitFor(() => expect(result.getPathname()).toBe('/admin/reports'));
  });

  it('says a summary that could not be read as that, never as a quiet day', async () => {
    server.on('POST /rest/v1/rpc/security_summary', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/security' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.securityNoticed)).toBeNull();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();
  });

  it('says an empty log as empty only once it was read', async () => {
    server.on('GET /rest/v1/security_events', () => []);
    server.on('GET /rest/v1/audit_log', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/security' });

    // One of the two logs failed: the screen says so rather than draw the other as the whole story.
    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();
  });
});
