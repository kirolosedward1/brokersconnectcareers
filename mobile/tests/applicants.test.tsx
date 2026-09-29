import type { ReactNode } from 'react';
import { Linking, Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ApplicationNoteRow, ProfileRow } from '@/lib/supabase/database.types';
import type { Applicant } from '~/features/employer/applicants';
import { parseInboxFilters } from '~/features/employer/applicants';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as InboxScreen from '../src/app/(tabs)/(applicants)/employer/applicants/index';
import * as PipelineScreen from '../src/app/(tabs)/(listings,applicants)/employer/jobs/[id]/applicants';
import { authSession, authUser, mobileConfig, ownedCompany, profile, USER_ID } from './auth-fixtures';
import { newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  A company's applicants on the phone — one listing's pipeline and the inbox
  across all of them — as the real screens draw them against stand-ins for
  Supabase and the website: who each applicant is (and a word when their
  profile is private), the moves and what they send, the reason written to
  the candidate, the notes they never see, the CV and WhatsApp, the "seen"
  stamp, and the inbox's filters.
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
const user = authUser();
const employer: ProfileRow = { ...profile, role: 'employer', full_name: 'أحمد سمير' };
const JOB_ID = '5b0c7d1e-0000-4000-8000-000000000301';
const listingRow = { id: JOB_ID, slug: 'sales-a1b2', title_ar: 'مستشار مبيعات', title_en: null, status: 'active' };

const sara: Applicant = {
  id: 'a0000000-0000-4000-8000-000000000001',
  status: 'new',
  created_at: '2026-09-20T10:00:00Z',
  note: 'متاحة من أول الشهر.',
  decision_note: null,
  cv_path: `${USER_ID}/cv.pdf`,
  experience_band: 'junior_1_3',
  employer_viewed_at: null,
  candidate: {
    full_name: 'سارة عادل',
    whatsapp_phone: '+20 100 123 4567',
    avatar_url: null,
    agent_profiles: {
      slug: 'sara-a1b2',
      headline_ar: 'مستشارة مبيعات أولية',
      headline_en: null,
      years_experience: 3,
      tracks: ['primary'],
      district_ids: [newCairo.id],
      units_closed: 12,
      volume_egp: null,
    },
  },
  job: { id: JOB_ID, title_ar: 'مستشار مبيعات', title_en: null, track: 'primary' },
};

const omar: Applicant = {
  id: 'a0000000-0000-4000-8000-000000000002',
  status: 'shortlisted',
  created_at: '2026-09-18T10:00:00Z',
  note: null,
  decision_note: 'مقابلة يوم الخميس.',
  cv_path: null,
  experience_band: 'mid_3_5',
  employer_viewed_at: '2026-09-19T10:00:00Z',
  candidate: { full_name: 'عمر حسن', whatsapp_phone: '+201112223334', avatar_url: null, agent_profiles: null },
  job: { id: JOB_ID, title_ar: 'مستشار مبيعات', title_en: null, track: 'primary' },
};

const notes: ApplicationNoteRow[] = [
  { id: 1, application_id: sara.id, author_id: USER_ID, body: 'كلّمتها، هترد الخميس.', created_at: '2026-09-21T10:00:00Z' },
  { id: 2, application_id: sara.id, author_id: 'c0000000-0000-4000-8000-000000000009', body: 'ملفها قوي.', created_at: '2026-09-22T10:00:00Z' },
];

let rows: Applicant[];
let client: QueryClient;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  rows = [sara, omar];
  jest.mocked(WebBrowser.openBrowserAsync).mockClear();

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [employer]);
  server.on('POST /rest/v1/rpc/my_company_id', () => ownedCompany.id);
  server.on('GET /rest/v1/companies', [ownedCompany]);
  server.on('/rest/v1/districts', [newCairo]);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('GET /rest/v1/jobs', [listingRow]);
  server.on('GET /rest/v1/applications', (url: URL) => {
    // The inbox's second read counts the stages; everything else is the rows.
    if (url.searchParams.get('select')?.startsWith('status,')) return rows.map((row) => ({ status: row.status }));
    return { body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } };
  });
  server.on('GET /rest/v1/application_notes', notes);
  server.on('GET /rest/v1/company_members', [{ user_id: USER_ID, profile: { full_name: 'أحمد سمير' } }]);
  server.on('POST /api/mobile/v1/actions/markApplicantsSeen', { ok: true });
  server.on('POST /api/mobile/v1/actions/setApplicationStatus', { ok: true });
  server.on('POST /api/mobile/v1/actions/addApplicationNote', { ok: true, data: { note: notes[0] } });
  server.on('POST /api/mobile/v1/actions/deleteApplicationNote', { ok: true });
  server.on(`GET /api/cv/${sara.id}`, { url: 'https://example.supabase.co/storage/v1/object/sign/cvs/cv.pdf?token=t' });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({
    userId: USER_ID,
    profile: { role: 'employer', approval_status: 'approved' },
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

function ConsultantStandIn() {
  return <Text>consultant</Text>;
}

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(listings,applicants)/employer/jobs/[id]/applicants': PipelineScreen,
  '(tabs)/(applicants)/employer/applicants/index': InboxScreen,
  '(tabs)/(listings,applicants)/agents/[slug]': ConsultantStandIn,
};

const input = (path: string, index = 0) => (server.asked(path)[index]?.body as { input: unknown } | undefined)?.input;

describe("a listing's applicants", () => {
  it('shows them by stage, with who they are — or that their profile is private — and stamps them seen', async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });

    expect(await screen.findByRole('header', { name: 'سارة عادل' })).toBeTruthy();
    expect(screen.getByRole('header', { name: ar.applicationStatus.new })).toBeTruthy();
    expect(screen.getByRole('header', { name: ar.applicationStatus.shortlisted })).toBeTruthy();
    expect(screen.getByText('مستشارة مبيعات أولية')).toBeTruthy();
    expect(screen.getByText(`3 سنوات خبرة · ${ar.track.primary} · ${newCairo.name_ar}`)).toBeTruthy();
    expect(screen.getByText(ar.employer.applicantProfilePrivate)).toBeTruthy();
    expect(screen.getByText('«متاحة من أول الشهر.»')).toBeTruthy();
    // The reason already given to the shortlisted one.
    expect(screen.getByDisplayValue('مقابلة يوم الخميس.')).toBeTruthy();
    // The company's notes, open because there are some; a colleague whose name is private reads as a former one.
    expect(await screen.findByText('كلّمتها، هترد الخميس.')).toBeTruthy();
    expect(screen.getByText(/^زميل سابق · /)).toBeTruthy();

    // Only the one nobody had opened.
    await waitFor(() => expect(input('/api/mobile/v1/actions/markApplicantsSeen')).toEqual({ ids: [sara.id] }));
  });

  it("moves an applicant with the stage the card showed, and the reason it held — and says so when a colleague got there first", async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.shortlisted}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.interview }));
    await waitFor(() =>
      expect(input('/api/mobile/v1/actions/setApplicationStatus')).toEqual({
        applicationId: omar.id,
        status: 'interview',
        decisionNote: 'مقابلة يوم الخميس.',
        from: 'shortlisted',
      }),
    );

    server.on('POST /api/mobile/v1/actions/setApplicationStatus', { ok: false, error: 'moved_already' });
    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.new}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.rejected }));
    expect(await screen.findByText(ar.employer.applicantMovedAlready)).toBeTruthy();
    // Put back: the card says where it stood.
    expect(screen.getByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.new}` })).toBeTruthy();
  });

  it('saves the reason written to the candidate on its own, at the same stage', async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    fireEvent.changeText(await screen.findByDisplayValue('مقابلة يوم الخميس.'), 'مقابلة يوم الأحد الساعة ١١.');
    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.decisionNote}: ${ar.common.save}` }));
    await waitFor(() =>
      expect(input('/api/mobile/v1/actions/setApplicationStatus')).toEqual({
        applicationId: omar.id,
        status: 'shortlisted',
        decisionNote: 'مقابلة يوم الأحد الساعة ١١.',
        from: 'shortlisted',
      }),
    );
  });

  it('adds a private note, and lets its author take their own back', async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText('كلّمتها، هترد الخميس.')).toBeTruthy();

    fireEvent.changeText(screen.getAllByLabelText(ar.employer.notesTitle)[0], 'اتفقنا على مقابلة.');
    fireEvent.press(screen.getAllByRole('button', { name: ar.employer.notesAdd })[0]);
    await waitFor(() =>
      expect(input('/api/mobile/v1/actions/addApplicationNote')).toEqual({ applicationId: sara.id, body: 'اتفقنا على مقابلة.' }),
    );

    // Only the viewer's own note offers a delete.
    expect(screen.getAllByRole('button', { name: /^حذف: / })).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: `${ar.common.delete}: كلّمتها، هترد الخميس.` }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/deleteApplicationNote')).toEqual({ id: 1 }));
  });

  it('opens the CV through the website, and WhatsApp with the opener written', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.downloadCv}: سارة عادل` }));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://example.supabase.co/storage/v1/object/sign/cvs/cv.pdf?token=t'),
    );
    // Asked with the app's token: the answer is only this company's to have.
    expect(server.asked(`/api/cv/${sara.id}`)).toHaveLength(1);
    expect(screen.getByText(ar.employer.noCv)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.whatsappCandidate}: سارة عادل` }));
    expect(openURL.mock.calls[0]?.[0]).toMatch(/^https:\/\/wa\.me\/201001234567\?text=.+/);
    expect(decodeURIComponent(String(openURL.mock.calls[0]?.[0]).split('text=')[1])).toContain('سارة عادل');
    openURL.mockRestore();
  });

  it('says when the hour’s CVs are used up', async () => {
    server.on(`GET /api/cv/${sara.id}`, { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 600 } });
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.downloadCv}: سارة عادل` }));
    expect(await screen.findByText(ar.app.applicants.cvLimit)).toBeTruthy();
  });

  it("opens an applicant's full profile from their card, for a company that may read the directory", async () => {
    const result = renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    fireEvent.press(await screen.findByHintText(ar.agents.viewProfile));
    await waitFor(() => expect(result.getPathname()).toBe('/agents/sara-a1b2'));
  });

  it('offers no way into the directory to an employer still waiting for approval', async () => {
    server.on('/rest/v1/profiles', [{ ...employer, approval_status: 'pending' }]);
    await rememberActor({ userId: USER_ID, profile: { role: 'employer', approval_status: 'pending' }, company: null });
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText('مستشارة مبيعات أولية')).toBeTruthy();
    expect(screen.queryByHintText(ar.agents.viewProfile)).toBeNull();
  });

  it("is not found when the listing is not the company's", async () => {
    server.on('GET /rest/v1/jobs', []);
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText(ar.common.notFound)).toBeTruthy();
  });
});

describe('the inbox', () => {
  it('reads its filters from the address and counts every stage under them', async () => {
    renderRouter(app, { initialUrl: '/employer/applicants?stage=new&track=primary&band=bogus' });

    expect(await screen.findByRole('header', { name: 'سارة عادل' })).toBeTruthy();
    const [main, counts] = [0, 1].map((index) => server.asked('/rest/v1/applications')[index]?.url.searchParams);
    const asked = [main, counts].find((params) => !params?.get('select')?.startsWith('status,'));
    expect(asked?.get('status')).toBe('eq.new');
    expect(asked?.get('job.track')).toBe('eq.primary');
    // An unknown value is ignored, as on the website.
    expect(asked?.get('experience_band')).toBeNull();
    expect(screen.getByText(`${ar.applicationStatus.new} (1)`)).toBeTruthy();
    expect(screen.getByText(`${ar.filters.any} (2)`)).toBeTruthy();
  });

  it('shows the stage as it is stored after a refresh, and moves the applicant on from there', async () => {
    // The server as it is: a move is refused unless it starts from the stored stage.
    server.on('POST /api/mobile/v1/actions/setApplicationStatus', (_url: URL, init: RequestInit | undefined) => {
      const move = (JSON.parse(String(init?.body)) as { input: { applicationId: string; status: Applicant['status']; from: string } }).input;
      const current = rows.find((row) => row.id === move.applicationId);
      if (!current || current.status !== move.from) return { ok: false, error: 'moved_already' };
      rows = rows.map((row) => (row.id === move.applicationId ? { ...row, status: move.status } : row));
      return { ok: true };
    });
    renderRouter(app, { initialUrl: '/employer/applicants' });
    expect(await screen.findByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.new}` })).toBeTruthy();

    // Moved elsewhere — on the listing's pipeline, or by a colleague — and read again here.
    rows = rows.map((row) => (row.id === sara.id ? { ...row, status: 'shortlisted' } : row));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['employer', 'applicants'] });
    });
    expect(await screen.findByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.shortlisted}` })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.shortlisted}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.interview }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/setApplicationStatus')).toMatchObject({ status: 'interview', from: 'shortlisted' }));
    expect(await screen.findByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.interview}` })).toBeTruthy();
    expect(screen.queryByText(ar.employer.applicantMovedAlready)).toBeNull();
  });

  it('searches by name, with LIKE’s own characters taken as typed', async () => {
    const result = renderRouter(app, { initialUrl: '/employer/applicants' });
    fireEvent.changeText(await screen.findByLabelText(ar.employer.searchApplicants), 'سارة_1%');
    fireEvent(screen.getByLabelText(ar.employer.searchApplicants), 'submitEditing');
    await waitFor(() => expect(result.getSearchParams()).toEqual({ q: 'سارة_1%' }));
    await waitFor(() =>
      expect(server.asked('/rest/v1/applications').some((request) => request.url.searchParams.get('candidate.full_name') === 'ilike.%سارة\\_1\\%%')).toBe(
        true,
      ),
    );
  });

  it('says a search found nobody, rather than that there are no applicants', async () => {
    rows = [];
    renderRouter(app, { initialUrl: '/employer/applicants?q=%D8%B2%D9%8A%D8%A7%D8%AF' });
    expect(await screen.findByText(ar.employer.searchEmpty)).toBeTruthy();
  });

  it('keeps only the filters it knows', () => {
    expect(parseInboxFilters({ stage: 'hired', job: 'not-a-uuid', q: `  ${'x'.repeat(100)} `, band: 'mid_3_5', track: 'nope' })).toEqual({
      stage: 'hired',
      job: null,
      q: 'x'.repeat(80),
      band: 'mid_3_5',
      track: null,
    });
  });
});
