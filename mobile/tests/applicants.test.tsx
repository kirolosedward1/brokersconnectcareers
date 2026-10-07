import type { ReactNode } from 'react';
import { Linking, RefreshControl, Text } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
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

const layla: Applicant = {
  id: 'a0000000-0000-4000-8000-000000000003',
  status: 'new',
  created_at: '2026-09-29T10:00:00Z',
  note: null,
  decision_note: null,
  cv_path: null,
  experience_band: null,
  employer_viewed_at: null,
  candidate: { full_name: 'ليلى محمود', whatsapp_phone: '+201223334445', avatar_url: null, agent_profiles: null },
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

/** A read held in flight until the test lets it go. */
function held<T>(answer: () => T) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { handler: async () => (await gate, answer()), release };
}

const pull = async () => {
  await act(async () => {
    screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
  });
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

  it("moves an applicant with the stage the card showed, and a reason only when one was typed for the move — and says so when a colleague got there first", async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });

    // His reason is the shortlist's, written for that stage: it does not ride
    // along to the next one, where the candidate would read it again.
    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.shortlisted}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.interview }));
    await waitFor(() =>
      expect(input('/api/mobile/v1/actions/setApplicationStatus')).toEqual({
        applicationId: omar.id,
        status: 'interview',
        decisionNote: null,
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

  it('sends a reason typed for a move along with it', async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    fireEvent.changeText(await screen.findByDisplayValue('مقابلة يوم الخميس.'), 'اتفقنا على مقابلة الأحد.');
    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.shortlisted}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.interview }));
    await waitFor(() =>
      expect(input('/api/mobile/v1/actions/setApplicationStatus')).toEqual({
        applicationId: omar.id,
        status: 'interview',
        decisionNote: 'اتفقنا على مقابلة الأحد.',
        from: 'shortlisted',
      }),
    );
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

  it('keeps the reason as typed when it could not be saved, and says why', async () => {
    server.on('POST /api/mobile/v1/actions/setApplicationStatus', () => {
      throw new TypeError('Network request failed');
    });
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    fireEvent.changeText(await screen.findByDisplayValue('مقابلة يوم الخميس.'), 'مقابلة يوم الأحد الساعة ١١.');
    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.decisionNote}: ${ar.common.save}` }));

    expect(await screen.findByText(ar.app.offline.body)).toBeTruthy();
    // Their words, to send again — not the stored ones under a "Saved" that is not true.
    expect(screen.getByDisplayValue('مقابلة يوم الأحد الساعة ١١.')).toBeTruthy();
    expect(screen.queryByText(ar.employer.decisionNoteSaved)).toBeNull();

    // Refused for any other reason: the general words, and still their sentence.
    server.on('POST /api/mobile/v1/actions/setApplicationStatus', { ok: false, error: 'failed' });
    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.decisionNote}: ${ar.common.save}` }));
    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.queryByText(ar.app.offline.body)).toBeNull();
    expect(screen.getByDisplayValue('مقابلة يوم الأحد الساعة ١١.')).toBeTruthy();
  });

  it('never sends a reason that is not on screen', async () => {
    // The first move from "new" is held, then lost; the box shows while it is on its way.
    let calls = 0;
    const first = held(() => {
      throw new TypeError('Network request failed');
    });
    server.on('POST /api/mobile/v1/actions/setApplicationStatus', async () => {
      calls += 1;
      return calls === 1 ? first.handler() : { ok: true };
    });
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.new}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.shortlisted }));
    fireEvent.changeText((await screen.findAllByLabelText(ar.employer.decisionNote))[0], 'ملف ممتاز، هنكلمك الأحد.');

    // Not in: back at "new", where the box is hidden — with the sentence still in it.
    await act(async () => first.release());
    expect(await screen.findByText(ar.app.offline.body)).toBeTruthy();
    expect(screen.getByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.new}` })).toBeTruthy();

    // The next move carries the reason the card holds, not the hidden sentence.
    fireEvent.press(screen.getByRole('button', { name: `${ar.employer.moveTo} (سارة عادل): ${ar.applicationStatus.new}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.rejected }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/setApplicationStatus')).toHaveLength(2));
    expect(input('/api/mobile/v1/actions/setApplicationStatus', 1)).toEqual({
      applicationId: sara.id,
      status: 'rejected',
      decisionNote: null,
      from: 'new',
    });
  });

  it("keeps what is typed on a card when a colleague's move, read again, puts it under another stage", async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    fireEvent.changeText(await screen.findByDisplayValue('مقابلة يوم الخميس.'), 'مقابلة يوم الأحد.');

    // A colleague moves him to interview; the page reads its applicants again (a pull, a push).
    rows = rows.map((row) => (row.id === omar.id ? { ...row, status: 'interview' } : row));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['employer', 'applicants'] });
    });

    expect(await screen.findByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.interview}` })).toBeTruthy();
    // The same card under its new stage, with the sentence still in it.
    expect(screen.getByDisplayValue('مقابلة يوم الأحد.')).toBeTruthy();
  });

  it('takes a move whose answer was lost as made, when the database has it', async () => {
    server.on('POST /api/mobile/v1/actions/setApplicationStatus', (_url: URL, init: RequestInit | undefined) => {
      const move = (JSON.parse(String(init?.body)) as { input: { applicationId: string; status: Applicant['status']; decisionNote: string | null } })
        .input;
      rows = rows.map((row) => (row.id === move.applicationId ? { ...row, status: move.status, decision_note: move.decisionNote } : row));
      throw new TypeError('Network request failed');
    });
    // The row as the database holds it, read by its id.
    server.on('GET /rest/v1/applications', (url: URL) => {
      const id = url.searchParams.get('id');
      if (id) return rows.filter((row) => `eq.${row.id}` === id).map((row) => ({ status: row.status, decision_note: row.decision_note }));
      if (url.searchParams.get('select')?.startsWith('status,')) return rows.map((row) => ({ status: row.status }));
      return { body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } };
    });
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.shortlisted}` }));
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.interview }));
    expect(await screen.findByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.interview}` })).toBeTruthy();
    await act(async () => {});
    // It happened: nothing says it did not.
    expect(screen.queryByText(ar.app.offline.body)).toBeNull();
    expect(screen.queryByText(ar.common.errorBody)).toBeNull();
    expect(server.asked('/api/mobile/v1/actions/setApplicationStatus')).toHaveLength(1);
  });

  it('takes back "not saved" once the stages, read again, show the move went in', async () => {
    // The move reaches the database and its answer is lost — and so is every
    // read for a while, the check that would have found it among them.
    let offline = true;
    server.on('POST /api/mobile/v1/actions/setApplicationStatus', (_url: URL, init: RequestInit | undefined) => {
      const move = (JSON.parse(String(init?.body)) as { input: { applicationId: string; status: Applicant['status']; decisionNote: string | null } })
        .input;
      rows = rows.map((row) => (row.id === move.applicationId ? { ...row, status: move.status, decision_note: move.decisionNote } : row));
      throw new TypeError('Network request failed');
    });
    server.on('GET /rest/v1/applications', (url: URL) => {
      if (offline) throw new TypeError('Network request failed');
      const id = url.searchParams.get('id');
      if (id) return rows.filter((row) => `eq.${row.id}` === id).map((row) => ({ status: row.status, decision_note: row.decision_note }));
      if (url.searchParams.get('select')?.startsWith('status,')) return rows.map((row) => ({ status: row.status }));
      return { body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } };
    });
    // The card is on screen before the connection goes.
    offline = false;
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    const button = await screen.findByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.shortlisted}` });
    offline = true;

    fireEvent.press(button);
    fireEvent.press(screen.getByRole('radio', { name: ar.applicationStatus.interview }));
    expect(await screen.findByText(ar.app.offline.body)).toBeTruthy();

    // Back online, the stages are read again: the move is there, so the card no longer says it is not.
    offline = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['employer', 'applicants'] });
    });
    expect(await screen.findByRole('button', { name: `${ar.employer.moveTo} (عمر حسن): ${ar.applicationStatus.interview}` })).toBeTruthy();
    expect(screen.queryByText(ar.app.offline.body)).toBeNull();
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

  it('writes a note once when its answer is lost, and says so when it did not go in', async () => {
    let written: ApplicationNoteRow[] = [];
    server.on('GET /rest/v1/application_notes', () => [...notes, ...written]);
    // The website stores the note, and its answer never reaches the phone.
    server.on('POST /api/mobile/v1/actions/addApplicationNote', () => {
      written = [{ id: 3, application_id: sara.id, author_id: USER_ID, body: 'اتفقنا على مقابلة.', created_at: '2026-09-29T10:00:00Z' }];
      throw new TypeError('Network request failed');
    });
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText('كلّمتها، هترد الخميس.')).toBeTruthy();

    fireEvent.changeText(screen.getAllByLabelText(ar.employer.notesTitle)[0], 'اتفقنا على مقابلة.');
    fireEvent.press(screen.getAllByRole('button', { name: ar.employer.notesAdd })[0]);
    // Asked of the database, it is there: the box empties, with nothing to send again.
    await waitFor(() => expect(screen.getAllByLabelText(ar.employer.notesTitle)[0].props.value).toBe(''));
    expect(await screen.findByText('اتفقنا على مقابلة.')).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/addApplicationNote')).toHaveLength(1);
    expect(screen.queryByText(ar.app.offline.body)).toBeNull();

    // Not there: the words stay for another try, and the reason is the connection.
    server.on('POST /api/mobile/v1/actions/addApplicationNote', () => {
      throw new TypeError('Network request failed');
    });
    fireEvent.changeText(screen.getAllByLabelText(ar.employer.notesTitle)[0], 'نكلمها تاني الأسبوع الجاي.');
    fireEvent.press(screen.getAllByRole('button', { name: ar.employer.notesAdd })[0]);
    expect(await screen.findByText(ar.app.offline.body)).toBeTruthy();
    expect(screen.getAllByLabelText(ar.employer.notesTitle)[0].props.value).toBe('نكلمها تاني الأسبوع الجاي.');
  });

  it('does not take an older note in the same words for the new one while the notes are unread', async () => {
    let reads = 0;
    // The card's notes could not be read; a later read shows last week's note in the same words.
    server.on('GET /rest/v1/application_notes', () => {
      reads += 1;
      if (reads === 1) return { status: 500, body: { message: 'upstream unavailable' } };
      return [{ id: 7, application_id: sara.id, author_id: USER_ID, body: 'لم يرد.', created_at: '2026-09-21T10:00:00Z' }];
    });
    server.on('POST /api/mobile/v1/actions/addApplicationNote', () => {
      throw new TypeError('Network request failed');
    });
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText('سارة عادل')).toBeTruthy();
    fireEvent.press(screen.getAllByRole('button', { name: new RegExp(ar.employer.notesTitle) })[0]);

    fireEvent.changeText(screen.getAllByLabelText(ar.employer.notesTitle)[0], 'لم يرد.');
    fireEvent.press(screen.getAllByRole('button', { name: ar.employer.notesAdd })[0]);
    // Not in, as far as anybody can tell: the words stay, and the reason is said.
    expect(await screen.findByText(ar.app.offline.body)).toBeTruthy();
    expect(screen.getAllByLabelText(ar.employer.notesTitle)[0].props.value).toBe('لم يرد.');
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

  it('takes in a new applicant with a pull, and stops spinning once it is in', async () => {
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText('سارة عادل')).toBeTruthy();
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);

    rows = [layla, ...rows];
    await pull();
    expect(await screen.findByText('ليلى محمود')).toBeTruthy();
    await waitFor(() => expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false));
  });

  it('takes in the first applicant with a pull on the empty listing', async () => {
    rows = [];
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText(ar.employer.noApplicants)).toBeTruthy();

    rows = [layla];
    await pull();
    expect(await screen.findByText('ليلى محمود')).toBeTruthy();
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

  it('takes in a new applicant with a pull', async () => {
    renderRouter(app, { initialUrl: '/employer/applicants' });
    expect(await screen.findByText('سارة عادل')).toBeTruthy();

    rows = [layla, ...rows];
    await pull();
    expect(await screen.findByText('ليلى محمود')).toBeTruthy();
    expect(screen.getByText(`${ar.filters.any} (3)`)).toBeTruthy();
  });

  it('keeps a note being written open while a new applicant is read in', async () => {
    renderRouter(app, { initialUrl: '/employer/applicants' });
    expect(await screen.findByText('كلّمتها، هترد الخميس.')).toBeTruthy();
    fireEvent.changeText(screen.getAllByLabelText(ar.employer.notesTitle)[0], 'نكلمها بكرة.');

    // A new applicant changes the cards, and with them the notes' read — held here.
    const notesRead = held(() => notes);
    server.on('GET /rest/v1/application_notes', notesRead.handler);
    rows = [layla, ...rows];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['employer', 'applicants'] });
    });
    expect(await screen.findByText('ليلى محمود')).toBeTruthy();

    // Her notes are on their way; the box being written in has not closed.
    expect(screen.getAllByLabelText(ar.employer.notesTitle)[0].props.value).toBe('نكلمها بكرة.');
    await act(async () => notesRead.release());
  });

  it('turns the spinner for a pull, and not for a read started by a move', async () => {
    renderRouter(app, { initialUrl: '/employer/applicants' });
    expect(await screen.findByText('سارة عادل')).toBeTruthy();

    const reading = held(() => ({ body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } }));
    server.on('GET /rest/v1/applications', reading.handler);
    // Read again for another reason (after a move, a push): no spinner.
    act(() => {
      void client.invalidateQueries({ queryKey: ['employer', 'applicants'] });
    });
    await waitFor(() => expect(server.asked('/rest/v1/applications').length).toBeGreaterThan(2));
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    await act(async () => reading.release());

    // A pull: the spinner, until the read is in.
    const again = held(() => ({ body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } }));
    server.on('GET /rest/v1/applications', again.handler);
    act(() => {
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
    await act(async () => again.release());
    await waitFor(() => expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false));
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

  it("offers every one of the company's listings, not only the ones on screen, and names the one it is narrowed to", async () => {
    const OTHER = '5b0c7d1e-0000-4000-8000-000000000302';
    const OLD = '5b0c7d1e-0000-4000-8000-000000000303';
    const titles = [
      { id: OTHER, title_ar: 'مدير مبيعات', title_en: null },
      { id: JOB_ID, title_ar: 'مستشار مبيعات', title_en: null },
    ];
    server.on('GET /rest/v1/jobs', (url: URL) =>
      url.searchParams.get('id') === `eq.${OLD}` ? [{ id: OLD, title_ar: 'مسؤول تسويق', title_en: null }] : titles,
    );
    // Narrowed to one listing, with nobody new on it.
    rows = [];
    const result = renderRouter(app, { initialUrl: `/employer/applicants?job=${JOB_ID}&stage=new` });

    // The picker names the listing, and offers the company's other one too.
    fireEvent.press(await screen.findByRole('button', { name: `${ar.employer.allListings}: مستشار مبيعات` }));
    fireEvent.press(await screen.findByRole('radio', { name: 'مدير مبيعات' }));
    await waitFor(() => expect(result.getSearchParams()).toMatchObject({ job: OTHER }));
    // A listing or a stage that empties the list is a filter, not "no applicants yet".
    expect(await screen.findByText(ar.employer.filterEmpty)).toBeTruthy();
    expect(screen.queryByText(ar.employer.noApplicants)).toBeNull();

    // One older than the newest two hundred is read on its own, and named.
    act(() => router.setParams({ job: OLD }));
    expect(await screen.findByRole('button', { name: `${ar.employer.allListings}: مسؤول تسويق` })).toBeTruthy();
    const read = server.asked('/rest/v1/jobs').find((request) => request.url.searchParams.get('id') === `eq.${OLD}`);
    expect(read?.url.searchParams.get('company_id')).toBe(`eq.${ownedCompany.id}`);
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

describe('a suspended company', () => {
  it('is told its applicants are hidden, in the inbox and on a listing, rather than shown an empty list', async () => {
    // The database answers none of them while the company is suspended (349).
    server.on('GET /rest/v1/companies', [{ ...ownedCompany, suspended_at: '2026-10-01T10:00:00Z' }]);

    const inbox = renderRouter(app, { initialUrl: '/employer/applicants' });
    expect(await screen.findByText(ar.employer.applicantsSuspendedTitle)).toBeTruthy();
    expect(screen.getByText(ar.employer.applicantsSuspendedBody)).toBeTruthy();
    expect(screen.queryByText(ar.employer.noApplicants)).toBeNull();
    inbox.unmount();

    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText(ar.employer.applicantsSuspendedTitle)).toBeTruthy();
  });

  // Before 349 is applied, the reads still bring the applicants back; the
  // candidates must not be told the company opened their applications. Each
  // screen has its rows once it asks for their notes, and a stamp would
  // follow within moments of that (the unsuspended tests above see one).
  const notStamped = async () => {
    await waitFor(() => expect(server.asked('/rest/v1/application_notes').length).toBeGreaterThan(0));
    await expect(
      waitFor(() => expect(server.asked('/api/mobile/v1/actions/markApplicantsSeen').length).toBeGreaterThan(0), {
        timeout: 500,
      }),
    ).rejects.toThrow();
  };

  it('does not stamp them seen in the inbox, even where the database still answers them', async () => {
    server.on('GET /rest/v1/companies', [{ ...ownedCompany, suspended_at: '2026-10-01T10:00:00Z' }]);
    renderRouter(app, { initialUrl: '/employer/applicants' });
    expect(await screen.findByText(ar.employer.applicantsSuspendedTitle)).toBeTruthy();
    await notStamped();
  });

  it("nor on a listing's applicants", async () => {
    server.on('GET /rest/v1/companies', [{ ...ownedCompany, suspended_at: '2026-10-01T10:00:00Z' }]);
    renderRouter(app, { initialUrl: `/employer/jobs/${JOB_ID}/applicants` });
    expect(await screen.findByText(ar.employer.applicantsSuspendedTitle)).toBeTruthy();
    await notStamped();
  });
});
