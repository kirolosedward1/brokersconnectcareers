import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { AdminAuditRow, ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AuditScreen from '../src/app/(tabs)/(admin)/admin/audit/index';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The audit log in the app — the website's /admin/audit — as the real screen
  draws it against a stand-in for Supabase: every decision newest first,
  fifty a page, the website's filters sent as the website sends them (a
  type, `direct`, one actor, one target), each entry opening what it was
  about, and a log that could not be read said as that — never as "no
  decisions yet", which is what the table answers an admin whose door is
  not open.
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
const COMPANY_ID = '6c1d8e2f-0000-4000-8000-000000000402';
const OTHER_ADMIN = '8b7c7f1e-0000-4000-8000-000000000099';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

const approved: AdminAuditRow = {
  id: 7,
  actor_id: USER_ID,
  actor_name: 'كيرلس إدوارد',
  action: 'job.approve',
  target_type: 'job',
  target_id: JOB_ID,
  target_label: 'مستشار مبيعات',
  reason: null,
  metadata: { from: 'pending_review', to: 'active' },
  via: 'console',
  created_at: '2026-10-20T10:00:00Z',
};

const edited: AdminAuditRow = {
  id: 6,
  actor_id: OTHER_ADMIN,
  actor_name: 'منى علي',
  action: 'company.direct_update',
  target_type: 'company',
  target_id: COMPANY_ID,
  target_label: 'شركة النيل',
  reason: 'تصحيح الاسم',
  metadata: { columns: ['name_ar'] },
  via: 'direct',
  created_at: '2026-10-19T10:00:00Z',
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
  server.on('GET /rest/v1/admin_audit_log', () => ({ body: [approved, edited], headers: { 'content-range': '0-1/2' } }));

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
});

/** An admin, signed in with their authenticator's code (aal2) unless told otherwise. */
async function signIn({ aal = 'aal2' }: { aal?: 'aal1' | 'aal2' } = {}) {
  const user = authUser({ factors: [totpFactor] });
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
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(home)/index': stand('home'),
  '(tabs)/(admin)/admin/index': stand('the overview'),
  '(tabs)/(admin)/admin/audit/index': AuditScreen,
  '(tabs)/(admin)/admin/jobs/[id]': stand('the listing'),
  '(tabs)/(admin)/admin/companies/[id]': stand('the company'),
  mfa: stand('the code screen'),
};

/** What the log last asked the table for: the query as PostgREST receives it. */
function lastRead() {
  const url = server.asked('/rest/v1/admin_audit_log').at(-1)?.url;
  return url ? Object.fromEntries(url.searchParams.entries()) : undefined;
}

describe('the audit log', () => {
  it('draws every decision newest first, fifty a page, with what each was about and who decided', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/audit' });

    expect(await screen.findByText(ar.admin.auditAction.job_approve)).toBeTruthy();
    expect(lastRead()).toEqual({ select: '*', order: 'created_at.desc,id.desc', offset: '0', limit: '50' });
    // Counted, so the pages know where they end.
    const request = server.requests.find((item) => item.url.pathname === '/rest/v1/admin_audit_log');
    expect(request).toBeTruthy();

    // The target, the move it recorded, the reason, the actor, and the direct edit marked as one.
    expect(screen.getByText('مستشار مبيعات')).toBeTruthy();
    expect(screen.getByText('pending_review → active')).toBeTruthy();
    expect(screen.getByText(ar.admin.auditAction.company_direct_update)).toBeTruthy();
    expect(screen.getByText('«تصحيح الاسم»')).toBeTruthy();
    expect(screen.getByText('name_ar')).toBeTruthy();
    // The filter's chip, and the entry's own badge.
    expect(screen.getAllByText(ar.admin.viaDirect)).toHaveLength(2);
    expect(screen.getByText('منى علي')).toBeTruthy();
    expect(screen.queryByText(ar.admin.trailEmpty)).toBeNull();
  });

  it('asks for one kind of target, or for the direct edits, exactly as the website does', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/audit' });
    await screen.findByText(ar.admin.auditAction.job_approve);

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.kind.job }));
    await waitFor(() => expect(lastRead()?.target_type).toBe('eq.job'));
    expect(lastRead()).not.toHaveProperty('via');

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.viaDirect }));
    await waitFor(() => expect(lastRead()?.via).toBe('eq.direct'));
    expect(lastRead()).not.toHaveProperty('target_type');

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.taxonomy }));
    await waitFor(() => expect(lastRead()?.target_type).toBe('eq.taxonomy'));

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.filterAll }));
    await waitFor(() => expect(lastRead()).toEqual({ select: '*', order: 'created_at.desc,id.desc', offset: '0', limit: '50' }));
  });

  it("opens the filters a website link names — a type, one admin's decisions, one target — and clears them", async () => {
    await signIn();
    renderRouter(app, { initialUrl: `/admin/audit?type=company&actor=${OTHER_ADMIN}&target=${COMPANY_ID}` });

    expect(await screen.findByText(ar.app.admin.audit.filteredActor)).toBeTruthy();
    expect(screen.getByText(ar.app.admin.audit.filteredTarget)).toBeTruthy();
    expect(lastRead()).toMatchObject({ target_type: 'eq.company', actor_id: `eq.${OTHER_ADMIN}`, target_id: `eq.${COMPANY_ID}` });
    expect(screen.getByRole('radio', { name: ar.admin.kind.company }).props.accessibilityState).toMatchObject({ checked: true });

    fireEvent.press(screen.getByRole('button', { name: ar.admin.clearFilter }));
    await waitFor(() => expect(lastRead()).not.toHaveProperty('actor_id'));
    expect(lastRead()).not.toHaveProperty('target_id');
    // The type stays, as on the website.
    expect(lastRead()?.target_type).toBe('eq.company');
    expect(screen.queryByText(ar.app.admin.audit.filteredActor)).toBeNull();
  });

  it('ignores an actor that is not an account id', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/audit?actor=somebody' });

    await screen.findByText(ar.admin.auditAction.job_approve);
    expect(lastRead()).not.toHaveProperty('actor_id');
    expect(screen.queryByText(ar.app.admin.audit.filteredActor)).toBeNull();
  });

  it("shows one admin's decisions from a tap on their name", async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/audit' });

    fireEvent.press(await screen.findByRole('button', { name: 'منى علي' }));
    await waitFor(() => expect(lastRead()?.actor_id).toBe(`eq.${OTHER_ADMIN}`));
    expect(await screen.findByText(ar.app.admin.audit.filteredActor)).toBeTruthy();
  });

  it('opens what a decision was about, on its own screen', async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: '/admin/audit' });

    fireEvent.press(await screen.findByRole('link', { name: 'مستشار مبيعات' }));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/jobs/${JOB_ID}`));
    expect(await screen.findByText('the listing')).toBeTruthy();
  });

  it('asks for the next fifty from where the last page ended, and stops at the total', async () => {
    const page = (offset: number, count: number): AdminAuditRow[] =>
      Array.from({ length: count }, (_, i) => ({ ...approved, id: 1000 - offset - i, target_label: `إعلان ${offset + i}` }));
    server.on('GET /rest/v1/admin_audit_log', (url: URL) => {
      const offset = Number(url.searchParams.get('offset'));
      return offset === 0
        ? { body: page(0, 50), headers: { 'content-range': '0-49/60' } }
        : { body: page(50, 10), headers: { 'content-range': '50-59/60' } };
    });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/audit' });

    expect(await screen.findByText('إعلان 0')).toBeTruthy();
    expect(lastRead()).toMatchObject({ offset: '0', limit: '50' });

    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(lastRead()).toMatchObject({ offset: '50', limit: '50' }));

    // Sixty of sixty: the end is the end.
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    expect(server.asked('/rest/v1/admin_audit_log')).toHaveLength(2);
  });

  it('says a log that could not be read failed — never that nothing was decided', async () => {
    server.on('GET /rest/v1/admin_audit_log', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/audit' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.trailEmpty)).toBeNull();

    server.on('GET /rest/v1/admin_audit_log', () => ({ body: [approved], headers: { 'content-range': '0-0/1' } }));
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(ar.admin.auditAction.job_approve)).toBeTruthy();
  });

  it('reads nothing until the door is open: an admin asked for their code sees the door, not an empty log', async () => {
    await signIn({ aal: 'aal1' });
    renderRouter(app, { initialUrl: '/admin/audit' });

    expect(await screen.findByText(ar.app.admin.door.challengeTitle)).toBeTruthy();
    expect(server.asked('/rest/v1/admin_audit_log')).toHaveLength(0);
    expect(screen.queryByText(ar.admin.trailEmpty)).toBeNull();
  });
});
