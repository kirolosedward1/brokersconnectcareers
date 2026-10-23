import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { AppealRow, ProfileRow } from '@/lib/supabase/database.types';
import { DecisionSheetHost } from '~/components/admin/decision-sheet';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AppealsScreen from '../src/app/(tabs)/(admin)/admin/appeals/index';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The appeals screen — the website's /admin/appeals — as the real screen
  draws it against stand-ins for Supabase and the website: the two views and
  exactly what each reads, the pages, what a card says, and the two levers,
  each through the website's own action with the note typed, and "done" only
  once the website has answered.
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
const APPELLANT = '8b7c7f1e-0000-4000-8000-000000000099';
const OPEN_APPEAL = 'c1000000-0000-4000-8000-000000000001';
const DECIDED_APPEAL = 'c1000000-0000-4000-8000-000000000002';

const adminProfile: ProfileRow = { ...profile, role: 'admin', full_name: 'كيرلس إدوارد' };

type Row = AppealRow & { appellant: { id: string; full_name: string } | null; decider: { full_name: string } | null };

const openAppeal: Row = {
  id: OPEN_APPEAL,
  subject_type: 'job',
  subject_id: JOB_ID,
  appellant_id: APPELLANT,
  message: 'الإعلان اترفض بس كل البيانات فيه صحيحة.',
  decision_snapshot: { status: 'rejected', note: 'الراتب مش واضح', label_ar: 'مستشار مبيعات', label_en: null },
  status: 'open',
  decided_by: null,
  decided_at: null,
  decision_note: null,
  created_at: '2026-10-18T10:00:00Z',
  appellant: { id: APPELLANT, full_name: 'أحمد سمير' },
  decider: null,
};

const decidedAppeal: Row = {
  ...openAppeal,
  id: DECIDED_APPEAL,
  subject_type: 'account',
  subject_id: APPELLANT,
  message: 'حسابي اتوقف من غير سبب.',
  decision_snapshot: { status: 'rejected', label_ar: 'أحمد سمير' },
  status: 'upheld',
  decided_by: USER_ID,
  decided_at: '2026-10-21T10:00:00Z',
  decision_note: 'الأوراق اللي اتبعتت مش بتاعت الشركة.',
  decider: { full_name: 'كيرلس إدوارد' },
};

let me: ProfileRow;
/** The page each read of the appeals asked for, in order, as "offset:limit". */
let pages: string[] = [];

function pageOf(url: URL): string {
  return `${url.searchParams.get('offset')}:${url.searchParams.get('limit')}`;
}

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  me = { ...adminProfile };
  pages = [];
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => null);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('GET /rest/v1/moderation_appeals', (url: URL) => {
    pages.push(pageOf(url));
    return url.searchParams.get('status') === 'eq.open'
      ? { body: [openAppeal], headers: { 'content-range': '0-0/1' } }
      : { body: [decidedAppeal], headers: { 'content-range': '0-0/1' } };
  });
  server.on('POST /api/mobile/v1/actions/decideAppeal', { ok: true });

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
  '(tabs)/(admin)/admin/appeals/index': AppealsScreen,
  '(tabs)/(admin)/admin/jobs/[id]': stand('the listing'),
  '(tabs)/(admin)/admin/users/[id]': stand('the account'),
  mfa: stand('the code screen'),
};

function actionsCalled(name: string) {
  return server.requests.filter((request) => request.method === 'POST' && request.url.pathname === `/api/mobile/v1/actions/${name}`);
}

/** The last read of the appeals: what it asked for. */
function lastRead() {
  return server.asked('/rest/v1/moderation_appeals').at(-1)?.url.searchParams;
}

/** The sheet's own confirm button: the last one with the lever's label, after the one on the screen that opened it. */
function confirmButton(label: string) {
  return screen.getAllByRole('button', { name: label }).at(-1)!;
}

describe('the appeals', () => {
  it('reads the waiting ones oldest first with both names, and says what each is about', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals' });

    expect(await screen.findByText(openAppeal.message)).toBeTruthy();
    const asked = lastRead()!;
    expect(asked.get('status')).toBe('eq.open');
    expect(asked.get('order')).toBe('created_at.asc,id.asc');
    expect(asked.get('select')).toMatch(/appellant:profiles!moderation_appeals_appellant_id_fkey\(id,full_name\)/);
    expect(asked.get('select')).toMatch(/decider:profiles!moderation_appeals_decided_by_fkey\(full_name\)/);
    expect(pages).toEqual(['0:20']);

    expect(screen.getByText(ar.admin.appealSubject.job)).toBeTruthy();
    expect(screen.getByText('مستشار مبيعات')).toBeTruthy();
    expect(screen.getByText('أحمد سمير')).toBeTruthy();
    // The decision as it stood when appealed, with the moderator's reason at the time.
    expect(screen.getByText(ar.admin.appealDecision.replace('{state}', ar.jobStatus.rejected))).toBeTruthy();
    expect(screen.getByText('«الراتب مش واضح»')).toBeTruthy();
    expect(screen.getByRole('button', { name: `${ar.admin.appealOverturn}: مستشار مبيعات` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${ar.admin.appealUphold}: مستشار مبيعات` })).toBeTruthy();
  });

  it('reads the answered ones newest answer first, with the outcome, who answered and the note — and no lever', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals' });
    await screen.findByText(openAppeal.message);

    fireEvent.press(screen.getByRole('radio', { name: ar.admin.appealView.decided }));
    expect(await screen.findByText(decidedAppeal.message)).toBeTruthy();
    const asked = lastRead()!;
    expect(asked.get('status')).toBe('neq.open');
    expect(asked.get('order')).toBe('decided_at.desc,id.asc');

    expect(screen.getByText(ar.admin.appealOutcome.upheld)).toBeTruthy();
    expect(screen.getByText(ar.admin.appealDecision.replace('{state}', ar.admin.approval.rejected))).toBeTruthy();
    expect(screen.getByText(ar.admin.appealDecidedBy.replace('{name}', 'كيرلس إدوارد').replace('{date}', '21 أكتوبر 2026'))).toBeTruthy();
    expect(screen.getByText(`«${decidedAppeal.decision_note}»`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(`^${ar.admin.appealOverturn}`) })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`^${ar.admin.appealUphold}`) })).toBeNull();
  });

  it('opens the view a website link names', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals?status=decided' });

    expect(await screen.findByText(decidedAppeal.message)).toBeTruthy();
    expect(lastRead()!.get('status')).toBe('neq.open');
    expect(screen.getByRole('radio', { name: ar.admin.appealView.decided }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it('asks for the next twenty from where the last page ended, and stops at the total', async () => {
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...openAppeal,
        id: `00000000-0000-4000-8000-${String(offset + i).padStart(12, '0')}`,
        message: `اعتراض ${offset + i}`,
      }));
    server.on('GET /rest/v1/moderation_appeals', (url: URL) => {
      const asked = pageOf(url);
      pages.push(asked);
      return asked === '0:20'
        ? { body: page(0, 20), headers: { 'content-range': '0-19/25' } }
        : { body: page(20, 5), headers: { 'content-range': '20-24/25' } };
    });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals' });

    expect(await screen.findByText('اعتراض 0')).toBeTruthy();
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    await waitFor(() => expect(pages).toEqual(['0:20', '20:20']));
    // Twenty-five of twenty-five: the end is the end.
    await act(async () => screen.UNSAFE_getByType(FlashList).props.onEndReached());
    expect(pages).toEqual(['0:20', '20:20']);
  });

  it('says a failed read failed — never that nothing is waiting', async () => {
    server.on('GET /rest/v1/moderation_appeals', { status: 503, body: { code: 'PGRST002', message: 'schema cache' } });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals' });

    expect(await screen.findByText(ar.common.retry)).toBeTruthy();
    expect(screen.queryByText(ar.admin.emptyQueue)).toBeNull();
  });

  it('opens what the appeal is about, and the appellant', async () => {
    await signIn();
    const result = renderRouter(app, { initialUrl: '/admin/appeals' });
    await screen.findByText(openAppeal.message);

    fireEvent.press(screen.getByText('مستشار مبيعات'));
    await waitFor(() => expect(result.getPathname()).toBe(`/admin/jobs/${JOB_ID}`));
  });
});

describe('answering an appeal', () => {
  it('reverses the decision through the website, the note optional, and says so only once the website has', async () => {
    let answer: (value: unknown) => void = () => {};
    server.on('POST /api/mobile/v1/actions/decideAppeal', () => new Promise((resolve) => (answer = resolve)));
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.appealOverturn}: مستشار مبيعات` }));
    expect(await screen.findByText(ar.admin.appealOverturnBody.job)).toBeTruthy();
    // The note is to the person, and may be left out with a reversal.
    const field = screen.getByLabelText(ar.admin.appealNoteToPerson);
    expect(field.props.maxLength).toBe(1000);
    expect(confirmButton(ar.admin.appealOverturn).props.accessibilityState?.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.appealOverturn));
    });

    await waitFor(() => expect(actionsCalled('decideAppeal')).toHaveLength(1));
    expect(actionsCalled('decideAppeal')[0].body).toEqual({ input: { appealId: OPEN_APPEAL, overturn: true } });
    expect(shownToast()).toBeNull();
    await act(async () => {
      answer({ ok: true });
    });
    await waitFor(() => expect(shownToast()?.message).toBe(`تم: ${ar.admin.appealOverturn}`));
  });

  it('lets a decision stand only with a note to the person, which it sends', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.appealUphold}: مستشار مبيعات` }));
    expect(await screen.findByText(ar.admin.appealUpholdBody)).toBeTruthy();
    const field = screen.getByLabelText(ar.admin.appealNoteToPerson);
    expect(confirmButton(ar.admin.appealUphold).props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(field, 'لا');
    expect(confirmButton(ar.admin.appealUphold).props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(field, 'الراتب الأساسي لسه مش مكتوب في الإعلان.');
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.appealUphold));
    });
    await waitFor(() => expect(actionsCalled('decideAppeal')).toHaveLength(1));
    expect(actionsCalled('decideAppeal')[0].body).toEqual({
      input: { appealId: OPEN_APPEAL, overturn: false, note: 'الراتب الأساسي لسه مش مكتوب في الإعلان.' },
    });
  });

  it("keeps the sheet open with the website's sentence when somebody else answered first", async () => {
    server.on('POST /api/mobile/v1/actions/decideAppeal', { ok: false, error: 'invalid_transition' });
    await signIn();
    renderRouter(app, { initialUrl: '/admin/appeals' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.admin.appealOverturn}: مستشار مبيعات` }));
    await screen.findByText(ar.admin.appealOverturnBody.job);
    await act(async () => {
      fireEvent.press(confirmButton(ar.admin.appealOverturn));
    });
    expect(await screen.findByText(ar.admin.errors.invalid_transition)).toBeTruthy();
    expect(shownToast()).toBeNull();
  });
});
