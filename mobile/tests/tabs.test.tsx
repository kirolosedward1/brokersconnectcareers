import { useEffect, useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { router, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ProfileRow } from '@/lib/supabase/database.types';
import type { Applicant } from '~/features/employer/applicants';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import TabsLayout from '../src/app/(tabs)/_layout';
import * as SharedLayout from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as InboxScreen from '../src/app/(tabs)/(applicants)/employer/applicants/index';
import * as DirectoryScreen from '../src/app/(tabs)/(consultants)/agents/index';
import { authSession, authUser, mobileConfig, ownedCompany, profile, USER_ID } from './auth-fixtures';
import { fakeServer } from './server';

/*
  The app's own tabs layout — not the stand-in the routing tests use — whose
  set of tabs follows the person, and whose tabs' screens are all drawn again
  whenever that set changes. What a tab nobody has opened may do at launch,
  and what survives an approval arriving while the app is open. The bar
  itself is tests/tab-bar.test.tsx.
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
const user = authUser();
const JOB_ID = '5b0c7d1e-0000-4000-8000-000000000301';

let employer: ProfileRow;
let client: QueryClient;

const sara: Applicant = {
  id: 'a0000000-0000-4000-8000-000000000001',
  status: 'new',
  created_at: '2026-09-20T10:00:00Z',
  note: null,
  decision_note: null,
  cv_path: null,
  experience_band: 'junior_1_3',
  employer_viewed_at: null,
  candidate: { full_name: 'سارة عادل', whatsapp_phone: '+201001234567', avatar_url: null, agent_profiles: null },
  job: { id: JOB_ID, title_ar: 'مستشار مبيعات', title_en: null, track: 'primary' },
};

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  employer = { ...profile, role: 'employer', full_name: 'أحمد سمير', approval_status: 'approved' };
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [employer]);
  server.on('POST /rest/v1/rpc/my_company_id', () => ownedCompany.id);
  server.on('GET /rest/v1/companies', [ownedCompany]);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('GET /rest/v1/applications', (url: URL) => {
    if (url.searchParams.get('select')?.startsWith('status,')) return [{ status: 'new' }];
    return { body: [sara], headers: { 'content-range': '0-0/1' } };
  });
  server.on('GET /rest/v1/application_notes', []);
  server.on('GET /rest/v1/districts', []);
  server.on('GET /api/mobile/v1/agents', { agents: [], total: 0, page: 1, pageCount: 1, pageSize: 20 });
  server.on('POST /api/mobile/v1/actions/markApplicantsSeen', { ok: true });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: 'correct-horse' });
  expect(error).toBeNull();
  await rememberActor({
    userId: USER_ID,
    profile: { role: 'employer', approval_status: employer.approval_status },
    company: { id: ownedCompany.id, verification_status: ownedCompany.verification_status },
  });
  server.requests.length = 0;
});

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

function Root() {
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

const standIn = (name: string) =>
  function StandIn() {
    return <Text>{name}</Text>;
  };

/** Stands for the job wizard: what is typed lives in the screen, and so does how many times it was drawn anew. */
let wizardMounts = 0;
function WizardStandIn() {
  const [draft] = useState(() => `draft-${wizardMounts + 1}`);
  useEffect(() => {
    wizardMounts += 1;
  }, []);
  return <Text>{draft}</Text>;
}

const SHARED = '(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)';

const app = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  '(tabs)/_layout': TabsLayout,
  [`${SHARED}/_layout`]: SharedLayout,
  '(tabs)/(home)/index': standIn('home-screen'),
  '(tabs)/(jobs)/jobs/index': standIn('board'),
  [`${SHARED}/companies/index`]: standIn('companies'),
  '(tabs)/(applications)/dashboard/applications/index': standIn('applications'),
  '(tabs)/(saved)/dashboard/saved/index': standIn('saved'),
  '(tabs)/(listings)/employer/jobs/index': standIn('listings'),
  '(tabs)/(listings)/employer/jobs/new': WizardStandIn,
  '(tabs)/(applicants)/employer/applicants/index': InboxScreen,
  '(tabs)/(consultants)/agents/index': DirectoryScreen,
  '(tabs)/(account)/account/index': standIn('account'),
};

describe('a tab nobody has opened', () => {
  it("neither reads the inbox nor tells candidates their application was opened, until the employer opens it", async () => {
    const result = renderRouter(app, { initialUrl: '/' });
    await screen.findByText('home-screen');
    await waitFor(() => expect(server.asked('/rest/v1/companies').length).toBeGreaterThan(0));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(result.getSegments()).toEqual(['(tabs)', '(home)']);
    expect(server.asked('/rest/v1/applications')).toHaveLength(0);
    expect(server.asked('/api/mobile/v1/agents')).toHaveLength(0);
    expect(server.asked('/api/mobile/v1/actions/markApplicantsSeen')).toHaveLength(0);

    act(() => router.navigate('/employer/applicants'));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/markApplicantsSeen')).toHaveLength(1));
    expect((server.asked('/api/mobile/v1/actions/markApplicantsSeen')[0].body as { input: { ids: string[] } }).input.ids).toEqual([
      sara.id,
    ]);
  });
});

describe('an approval that arrives while the app is open', () => {
  it('leaves the tabs, and a listing half written, as they were; the directory says who it is for until then', async () => {
    employer = { ...employer, approval_status: 'pending' };
    await rememberActor({
      userId: USER_ID,
      profile: { role: 'employer', approval_status: 'pending' },
      company: { id: ownedCompany.id, verification_status: ownedCompany.verification_status },
    });
    wizardMounts = 0;
    renderRouter(app, { initialUrl: '/employer/jobs/new' });
    expect(await screen.findByText('draft-1')).toBeTruthy();

    act(() => router.navigate('/agents'));
    expect(await screen.findByText(ar.agents.subtitle)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/agents')).toHaveLength(0);
    act(() => router.navigate('/employer/jobs/new'));

    // The team approves the account; the app reads it again (back from the background, a pull to refresh).
    employer = { ...employer, approval_status: 'approved' };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['viewer'] });
    });
    await waitFor(() => expect(server.asked('/rest/v1/profiles').length).toBeGreaterThanOrEqual(2));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText('draft-1')).toBeTruthy();
    expect(wizardMounts).toBe(1);
    act(() => router.navigate('/agents'));
    await waitFor(() => expect(server.asked('/api/mobile/v1/agents').length).toBeGreaterThan(0));
    expect(screen.queryByText(ar.agents.title)).toBeNull();
  });
});
