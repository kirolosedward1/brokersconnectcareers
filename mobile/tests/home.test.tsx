import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { formatList } from '@/lib/format';
import type { JobListItem } from '@/lib/job-list';
import type { AgentProfileRow, CandidateSummary, ProfileRow } from '@/lib/supabase/database.types';
import type { CandidateApplication } from '~/features/applications/queries';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as HomeScreen from '../src/app/(tabs)/(home)/index';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { board, browse, listing, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  A candidate's Home — the website's /dashboard — as the real screen draws it
  against stand-ins for Supabase and the website: the figures and the one
  next action, the latest applications, roles ranked against the profile and
  why, and where the account stands when it is not in good standing. What is
  checked is what is said, what is left out, and where each tap goes.
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

// Three open roles, newest first: one already applied to, one in another track
// and district, one on the candidate's own track and district.
const applied: JobListItem = { ...listing, id: '5b0c7d1e-0000-4000-8000-000000000201', slug: 'applied-a1b2', title_ar: 'مستشار مبيعات' };
const elsewhere: JobListItem = {
  ...listing,
  id: '5b0c7d1e-0000-4000-8000-000000000202',
  slug: 'leasing-a1b2',
  title_ar: 'مسؤول تأجير',
  track: 'resale',
  district_id: 99,
  experience_band: 'senior_5_plus',
};
const fitting: JobListItem = { ...listing, id: '5b0c7d1e-0000-4000-8000-000000000203', slug: 'primary-a1b2', title_ar: 'استشاري مبيعات أولية' };

const application: CandidateApplication = {
  id: 'a0000000-0000-4000-8000-000000000001',
  job_id: applied.id,
  status: 'shortlisted',
  created_at: '2026-09-20T10:00:00Z',
  decision_note: null,
  employer_viewed_at: '2026-09-21T10:00:00Z',
  job: {
    slug: applied.slug,
    status: 'active',
    expires_at: applied.expires_at,
    title_ar: applied.title_ar,
    title_en: null,
    company: { name_ar: 'النيل للوساطة', name_en: null, slug: 'nile-brokers' },
    district: { name_ar: newCairo.name_ar, name_en: newCairo.name_en },
  },
};

const agent: AgentProfileRow = {
  id: '0a000000-0000-4000-8000-000000000001',
  user_id: USER_ID,
  slug: 'sara-a1b2',
  headline_ar: null,
  headline_en: null,
  years_experience: 2,
  tracks: ['primary'],
  district_ids: [newCairo.id],
  languages: ['ar'],
  cv_path: null,
  availability: 'open_to_offers',
  visibility: 'verified_employers_only',
  summary_ar: null,
  summary_en: null,
  units_closed: null,
  volume_egp: null,
  restricted_at: null,
  restriction_reason: null,
  created_at: '2026-09-01T10:00:00Z',
};

function summary(overrides: Partial<CandidateSummary> = {}): CandidateSummary {
  return {
    applications_total: 1,
    applications_new: 0,
    applications_moved: 1,
    applications_hired: 0,
    replies: 1,
    saved_jobs: 3,
    saved_searches: 1,
    alerts_on: 1,
    profile_completeness: 80,
    has_profile: true,
    profile_views_30d: 0,
    open_jobs: 3,
    ...overrides,
  };
}

let me: ProfileRow;

const warnings: string[] = [];
beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  // No message may fail to format: the provider reports each one here.
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
  warnings.length = 0;
});

beforeEach(async () => {
  me = { ...profile };
  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/candidate_summary', summary());
  server.on('GET /rest/v1/applications', [application]);
  server.on('GET /rest/v1/agent_profiles', [agent]);
  server.on('GET /rest/v1/agent_developers', []);
  server.on('GET /rest/v1/saved_jobs', []);
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/api/mobile/v1/jobs', board([applied, elsewhere, fitting]));
  server.on('/api/mobile/v1/browse', browse);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('POST /rest/v1/rpc/my_account_note', () => 'حسابك عليه بلاغات كتير بنراجعها.');
  server.on('POST /rest/v1/rpc/my_appeal_state', { appealable: true, open: null, last: null });
  server.on('POST /api/mobile/v1/actions/submitAppeal', { ok: true });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
});

async function signIn(approval: ProfileRow['approval_status'] = 'approved') {
  me = { ...profile, approval_status: approval };
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: approval }, company: null });
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

/** Where a tap lands, standing in for the screen there. */
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
  '(tabs)/(jobs)/jobs/index': stand('the board'),
  '(tabs)/(applications)/dashboard/applications/index': stand('the applications'),
  '(tabs)/(saved)/dashboard/saved/index': stand('the saved list'),
  '(tabs)/(account)/account/profile': stand('the profile'),
};

const open = () => renderRouter(app, { initialUrl: '/' });

describe("a candidate's home", () => {
  it('opens on their overview: the reply first, the figures, the latest application', async () => {
    await signIn();
    open();

    expect(await screen.findByText(`أهلاً ${profile.full_name}`)).toBeTruthy();
    expect(await screen.findByText('فيه رد على طلب')).toBeTruthy();
    // Each figure says what it is, to VoiceOver as well.
    expect(screen.getByLabelText(`${ar.dashboard.statApplications}: 1`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statCompleteness}: 80%`)).toBeTruthy();
    expect(screen.getByLabelText(`${ar.dashboard.statAlerts}: 1`)).toBeTruthy();
    // The latest application and where it stands.
    expect(screen.getByLabelText(formatList([applied.title_ar, 'النيل للوساطة', ar.applicationStatus.shortlisted], 'ar'))).toBeTruthy();
    // Nothing to say about the account while it is in good standing.
    expect(screen.queryByText(ar.standing.heldTitle) === null).toBe(true);
    expect(server.asked('/rest/v1/rpc/my_account_note')).toHaveLength(0);
  });

  it("suggests roles on the candidate's own track and district first, says why, and leaves out one applied to", async () => {
    await signIn();
    open();

    expect(await screen.findByText(ar.dashboard.matchedRoles)).toBeTruthy();
    const titles = (await screen.findAllByText(new RegExp(`^(${fitting.title_ar}|${elsewhere.title_ar})$`))).map(
      (node) => node.props.children,
    );
    expect(titles).toEqual([fitting.title_ar, elsewhere.title_ar]);
    expect(screen.getByText(`${ar.dashboard.matchWhy} ${formatList([ar.track.primary, newCairo.name_ar, ar.dashboard.matchExperience], 'ar')}`)).toBeTruthy();
    // Applied to already: in the applications above, not among the suggestions.
    expect(screen.getAllByText(applied.title_ar)).toHaveLength(1);
    expect(screen.queryByText(ar.dashboard.matchNudge) === null).toBe(true);
  });

  it.each([
    [`${ar.dashboard.statCompleteness}: 80%`, '/account/profile'],
    [`${ar.dashboard.statSaved}: 3`, '/dashboard/saved'],
    [`${ar.dashboard.statReplies}: 1`, '/dashboard/applications'],
    [`فيه رد على طلب. ${ar.dashboard.nextRepliesBody}`, '/dashboard/applications'],
  ])('sends "%s" to where it can be acted on', async (name, path) => {
    await signIn();
    const result = open();
    fireEvent.press(await screen.findByRole('link', { name }));
    await waitFor(() => expect(result.getPathname()).toBe(path));
  });

  it('asks for the profile when it is under 60%, and does not call newest-first a match without a track or district', async () => {
    server.on('POST /rest/v1/rpc/candidate_summary', summary({ replies: 0, profile_completeness: 40 }));
    // A profile that has said nothing to match on.
    server.on('GET /rest/v1/agent_profiles', [{ ...agent, tracks: [], district_ids: [], years_experience: null }]);
    await signIn();
    const result = open();

    expect(await screen.findByText(ar.dashboard.nextProfileTitle)).toBeTruthy();
    expect(await screen.findByText(ar.dashboard.openRoles)).toBeTruthy();
    expect(screen.getByText(ar.dashboard.matchNudge)).toBeTruthy();
    expect(screen.queryByText(new RegExp(ar.dashboard.matchWhy)) === null).toBe(true);

    fireEvent.press(screen.getByRole('link', { name: ar.dashboard.matchNudgeCta }));
    await waitFor(() => expect(result.getPathname()).toBe('/account/profile'));
  });

  it('tells a new account where to start', async () => {
    server.on('POST /rest/v1/rpc/candidate_summary', summary({ applications_total: 0, replies: 0 }));
    server.on('GET /rest/v1/applications', []);
    await signIn();
    const result = open();

    expect(await screen.findByText(ar.dashboard.emptyCandidateTitle)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.jobs.title }));
    await waitFor(() => expect(result.getPathname()).toBe('/jobs'));
  });

  it('never says "start here" when the figures could not be read', async () => {
    server.on('POST /rest/v1/rpc/candidate_summary', { status: 500, body: { message: 'down' } });
    server.on('GET /rest/v1/applications', { status: 500, body: { message: 'down' } });
    await signIn();
    open();

    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.queryByText(ar.dashboard.emptyCandidateTitle) === null).toBe(true);
    // No figures either: there are none to show.
    expect(screen.queryByLabelText(ar.dashboard.overview) === null).toBe(true);
  });

  it("tells a held account why, and lets them ask for a second look", async () => {
    await signIn('pending');
    open();

    expect(await screen.findByText(ar.standing.heldTitle)).toBeTruthy();
    expect(screen.getByText(ar.standing.heldBodyCandidate)).toBeTruthy();
    expect(await screen.findByText('ملاحظة فريقنا: حسابك عليه بلاغات كتير بنراجعها.')).toBeTruthy();

    fireEvent.press(await screen.findByRole('button', { name: ar.appeals.ask }));
    fireEvent.changeText(screen.getByLabelText(ar.appeals.label), 'أنا مسجّلة من شهر ومقدّمتش غير على وظيفتين.');
    fireEvent.press(screen.getByRole('button', { name: ar.appeals.send }));

    expect(await screen.findByText(ar.appeals.sent)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/submitAppeal')[0]?.body).toEqual({
      input: { subjectType: 'account', subjectId: USER_ID, message: 'أنا مسجّلة من شهر ومقدّمتش غير على وظيفتين.' },
    });
  });

  it('says so when the account is suspended', async () => {
    await signIn('rejected');
    open();
    expect(await screen.findByText(ar.standing.suspendedTitle)).toBeTruthy();
    expect(screen.getByText(ar.standing.suspendedBodyCandidate)).toBeTruthy();
  });
});

describe('the Terms and the Privacy policy', () => {
  const versions = { terms: '2026-10-01', privacy: '2026-10-01' };
  type Acceptance = { terms_version: string; privacy_version: string; accepted_at?: string };

  /** policy_acceptances as PostgREST answers: the rows the filters keep, in the order and number asked for. */
  const acceptances = (rows: () => Acceptance[]) => (url: URL) => {
    const kept = rows().filter((row) =>
      (['terms_version', 'privacy_version'] as const).every((column) => {
        const filter = url.searchParams.get(column);
        return filter === null || filter === `eq.${row[column]}`;
      }),
    );
    if (url.searchParams.get('order') === 'accepted_at.desc') {
      kept.sort((a, b) => (b.accepted_at ?? '').localeCompare(a.accepted_at ?? ''));
    }
    const limit = url.searchParams.get('limit');
    return limit ? kept.slice(0, Number(limit)) : kept;
  };

  /**
   * The answer asked for, drawn: TanStack tells the screens on a timer (fake,
   * under renderRouter), and "no notice" is only worth asserting once it has.
   */
  async function answered() {
    await waitFor(() => expect(server.asked('/rest/v1/policy_acceptances')).toHaveLength(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
  }

  it('asks somebody who never agreed, and records the agreement through the website', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ policies: versions }));
    let accepted: Acceptance[] = [];
    server.on('GET /rest/v1/policy_acceptances', acceptances(() => accepted));
    server.on('POST /api/mobile/v1/actions/acceptPolicies', () => {
      accepted = [{ terms_version: versions.terms, privacy_version: versions.privacy }];
      return { ok: true };
    });
    await signIn();
    open();

    expect(await screen.findByText(ar.legal.updatedTitle)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.legal.agree }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/acceptPolicies')).toHaveLength(1));
    // The versions are the website's to record, never the phone's.
    expect(server.asked('/api/mobile/v1/actions/acceptPolicies')[0].body).toEqual({ input: null });
    await waitFor(() => expect(screen.queryByText(ar.legal.updatedTitle)).toBeNull());
  });

  it('takes the agreement when a release changed a document after the phone last asked', async () => {
    // The phone read the versions before the deploy; the website records its own, newer pair.
    const newer = { terms: '2026-12-01', privacy: '2026-10-01' };
    let published = versions;
    server.on('GET /api/mobile/v1/config', () => mobileConfig({ policies: published }));
    let accepted: Acceptance[] = [];
    server.on('GET /rest/v1/policy_acceptances', acceptances(() => accepted));
    server.on('POST /api/mobile/v1/actions/acceptPolicies', () => {
      accepted = [{ terms_version: newer.terms, privacy_version: newer.privacy }];
      return { ok: true };
    });
    await signIn();
    open();
    expect(await screen.findByText(ar.legal.updatedTitle)).toBeTruthy();

    published = newer;
    fireEvent.press(screen.getByRole('button', { name: ar.legal.agree }));
    await waitFor(() =>
      expect(server.asked('/rest/v1/policy_acceptances').at(-1)?.url.searchParams.get('terms_version')).toBe('eq.2026-12-01'),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByText(ar.legal.updatedTitle)).toBeNull();
  });

  it('asks again when a document has changed since', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ policies: { terms: '2026-12-01', privacy: '2026-10-01' } }));
    server.on('GET /rest/v1/policy_acceptances', acceptances(() => [{ terms_version: '2026-10-01', privacy_version: '2026-10-01' }]));
    await signIn();
    open();
    expect(await screen.findByText(ar.legal.updatedTitle)).toBeTruthy();
    // It looks for an agreement to the versions published now.
    const asked = server.asked('/rest/v1/policy_acceptances')[0].url.searchParams;
    expect([asked.get('terms_version'), asked.get('privacy_version')]).toEqual(['eq.2026-12-01', 'eq.2026-10-01']);
  });

  it('asks nothing of somebody who agreed to what is current', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ policies: versions }));
    server.on('GET /rest/v1/policy_acceptances', acceptances(() => [{ terms_version: versions.terms, privacy_version: versions.privacy }]));
    await signIn();
    open();
    expect(await screen.findByText(`أهلاً ${profile.full_name}`)).toBeTruthy();
    await answered();
    expect(screen.queryByText(ar.legal.updatedTitle)).toBeNull();
  });

  it('asks nothing of somebody who agreed to these versions before a later pair that was taken back', async () => {
    // Agreed to the current pair, then to a newer one a release brought and its rollback took away.
    server.on('GET /api/mobile/v1/config', mobileConfig({ policies: versions }));
    server.on(
      'GET /rest/v1/policy_acceptances',
      acceptances(() => [
        { terms_version: versions.terms, privacy_version: versions.privacy, accepted_at: '2026-10-02T08:00:00Z' },
        { terms_version: '2026-12-01', privacy_version: '2026-12-01', accepted_at: '2026-12-02T08:00:00Z' },
      ]),
    );
    await signIn();
    open();
    expect(await screen.findByText(`أهلاً ${profile.full_name}`)).toBeTruthy();
    await answered();
    expect(screen.queryByText(ar.legal.updatedTitle)).toBeNull();
  });

  it('asks nothing when the website does not say what is current, and does not look', async () => {
    await signIn();
    open();
    expect(await screen.findByText(`أهلاً ${profile.full_name}`)).toBeTruthy();
    expect(screen.queryByText(ar.legal.updatedTitle)).toBeNull();
    expect(server.asked('/rest/v1/policy_acceptances')).toHaveLength(0);
  });
});

describe('a directory card nobody asked about', () => {
  it('asks a candidate whose card was listed before onboarding asked, and leads to the profile', async () => {
    server.on('GET /rest/v1/agent_profiles', [{ ...agent, visibility_chosen_at: null }]);
    await signIn();
    open();

    expect(await screen.findByText(ar.dashboard.visibilityAskTitle)).toBeTruthy();
    expect(screen.getByText(ar.dashboard.visibilityAskBody.replace('{current}', ar.visibility.verified_employers_only))).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.dashboard.visibilityAskCta }));
    expect(await screen.findByText('the profile')).toBeTruthy();
  });

  it('says nothing once they have chosen', async () => {
    server.on('GET /rest/v1/agent_profiles', [{ ...agent, visibility_chosen_at: '2026-10-01T10:00:00Z' }]);
    await signIn();
    open();
    expect(await screen.findByText(`أهلاً ${profile.full_name}`)).toBeTruthy();
    await waitFor(() => expect(server.asked('/rest/v1/agent_profiles').length).toBeGreaterThan(0));
    expect(screen.queryByText(ar.dashboard.visibilityAskTitle)).toBeNull();
  });
});
