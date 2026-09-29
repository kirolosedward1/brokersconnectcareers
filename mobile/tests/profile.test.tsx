import type { ReactNode } from 'react';
import { Alert, Text, type AlertButton } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { AgentExperienceRow, AgentProfileRow } from '@/lib/supabase/database.types';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as ProfileScreen from '../src/app/(tabs)/(account)/account/profile';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  The candidate's directory profile, as they edit it on a phone: the real
  screen against stand-ins for Supabase and the website. What is checked is
  what each of the website's actions is sent — the profile, the record, each
  CV entry, an appeal — what is uploaded and taken back out, and that a
  profile that could not be read is never offered as an empty form.
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

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ arrayBuffer: async () => new ArrayBuffer(2048) })),
}));

const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();
const AGENT_ID = '0a000000-0000-4000-8000-000000000001';

const baseAgent: AgentProfileRow = {
  id: AGENT_ID,
  user_id: USER_ID,
  slug: 'sara-a1b2',
  headline_ar: null,
  headline_en: null,
  years_experience: 3,
  tracks: ['primary'],
  district_ids: [newCairo.id],
  languages: ['ar'],
  cv_path: `${USER_ID}/cv.pdf`,
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

const job: AgentExperienceRow = {
  id: '0e000000-0000-4000-8000-000000000001',
  agent_id: AGENT_ID,
  company_name: 'نايل بروكرز',
  title: 'مستشار مبيعات',
  track: 'primary',
  district_id: null,
  started: '2021-03-15',
  ended: null,
  highlights: null,
  sort_order: 0,
  created_at: '2026-09-01T10:00:00Z',
};

let agent: AgentProfileRow | null;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  agent = { ...baseAgent };
  jest.mocked(DocumentPicker.getDocumentAsync).mockReset();

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', [profile]);
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/developers', [{ id: 3, name_ar: 'بالم هيلز', name_en: 'Palm Hills', slug: 'palm-hills' }]);
  server.on('GET /rest/v1/agent_profiles', () => (agent ? [agent] : []));
  server.on('GET /rest/v1/agent_developers', [{ developer_id: 3 }]);
  server.on('GET /rest/v1/agent_experience', [job]);
  server.on('GET /rest/v1/agent_education', []);
  server.on('GET /rest/v1/agent_certifications', []);
  server.on('POST /rest/v1/rpc/profile_completeness', () => 45);
  server.on('POST /rest/v1/rpc/candidate_summary', { profile_views_30d: 0 });
  server.on('POST /rest/v1/rpc/my_appeal_state', { appealable: true, open: null, last: null });
  server.on('POST /api/mobile/v1/actions/saveAgentProfile', { ok: true });
  server.on('POST /api/mobile/v1/actions/saveProfileRecord', { ok: true });
  server.on('POST /api/mobile/v1/actions/saveExperience', { ok: true, data: { id: 'new' } });
  server.on('POST /api/mobile/v1/actions/deleteCvEntry', { ok: true });
  server.on('POST /api/mobile/v1/actions/submitAppeal', { ok: true });
  server.on('POST /storage/v1/object/cvs/*', { Id: 'object-1', Key: 'cvs/uploaded' });
  server.on('DELETE /storage/v1/object/cvs', []);

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null });
  server.requests.length = 0;
});

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

function PreviewStandIn() {
  return <Text>preview</Text>;
}

const app = {
  _layout: Root,
  '(tabs)/(account)/_layout': () => <Stack />,
  '(tabs)/(account)/account/profile': ProfileScreen,
  '(tabs)/(account)/account/profile/preview': PreviewStandIn,
};

const open = (query = '') => renderRouter(app, { initialUrl: `/account/profile${query}` });
const bodyOf = (path: string, index = 0) => server.asked(path)[index]?.body as { input?: Record<string, unknown> } | undefined;
const saveButton = () => screen.getAllByRole('button', { name: ar.common.save })[0];

describe('the profile', () => {
  it("says what is missing, biggest gain first, over the form filled from the profile", async () => {
    open();
    expect(await screen.findByText(ar.cv.gapsTitle)).toBeTruthy();
    expect(await screen.findByText('اكتمال الملف 45%')).toBeTruthy();
    // The objective (20), the headline (15), the record and education (10 each); the rest is done.
    expect(screen.getAllByText(/^\+\d+$/).map((badge) => badge.props.children)).toEqual(['+20', '+15', '+10', '+10']);
    expect(screen.getByText(ar.cv.gap_headline)).toBeTruthy();
    expect(screen.getByLabelText(ar.onboarding.fullName).props.value).toBe(profile.full_name);
    expect(screen.getByText(ar.agents.cvCurrent)).toBeTruthy();
  });

  it('saves through the website, with every choice made on the form', async () => {
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.track.resale }));
    fireEvent.press(screen.getByRole('radio', { name: new RegExp(ar.visibility.public) }));
    fireEvent.press(saveButton());

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/saveAgentProfile')).toEqual({
        input: {
          fullName: profile.full_name,
          whatsapp: profile.whatsapp_phone,
          headlineAr: null,
          headlineEn: null,
          yearsExperience: 3,
          tracks: ['primary', 'resale'],
          districtIds: [newCairo.id],
          developerIds: [3],
          languages: ['ar'],
          availability: 'open_to_offers',
          visibility: 'public',
          cvPath: null,
          removeCv: false,
        },
      }),
    );
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();
  });

  it('takes the CV off when asked, and only then', async () => {
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.agents.cvRemove }));
    fireEvent.press(saveButton());
    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/saveAgentProfile')?.input?.removeCv).toBe(true));
  });

  it('uploads a new CV first, and takes it back out when the website refuses it', async () => {
    server.on('POST /api/mobile/v1/actions/saveAgentProfile', { ok: false, error: 'invalid', fieldErrors: { cv: 'fileType' } });
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/cv.pdf', name: 'cv.pdf', mimeType: 'application/pdf', size: 2048, lastModified: 0 }],
    } as DocumentPicker.DocumentPickerResult);
    open();

    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText('cv.pdf')).toBeTruthy();
    fireEvent.press(saveButton());

    expect(await screen.findByText(ar.validation.fileType)).toBeTruthy();
    const path = String(bodyOf('/api/mobile/v1/actions/saveAgentProfile')?.input?.cvPath);
    expect(path).toMatch(new RegExp(`^${USER_ID}/[0-9a-f-]{36}\\.pdf$`));
    await waitFor(() => expect(server.asked('/storage/v1/object/cvs')[0]?.body).toEqual({ prefixes: [path] }));
  });

  it('catches a phone number the website would refuse, before sending anything', async () => {
    open();
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.whatsapp), '12');
    fireEvent.press(saveButton());
    expect(await screen.findByText(ar.validation.invalidPhone)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/saveAgentProfile')).toHaveLength(0);
  });

  it('never offers an empty form over a profile it could not read', async () => {
    server.on('GET /rest/v1/agent_profiles', { status: 500, body: { message: 'boom' } });
    open();
    expect(await screen.findByText(ar.common.error)).toBeTruthy();
    expect(screen.queryByLabelText(ar.onboarding.fullName)).toBeNull();
  });

  it('offers the form to somebody with no profile yet, and says what comes after', async () => {
    agent = null;
    open();
    expect(await screen.findByText(ar.app.profile.saveFirst)).toBeTruthy();
    expect(screen.queryByText(ar.cv.gapsTitle)).toBeNull();
    // Nothing to preview until there is a card.
    expect(screen.queryByRole('button', { name: ar.dashboard.profilePreview })).toBeNull();
  });

  it('opens the card as companies see it, one tap from the form', async () => {
    const result = open();
    fireEvent.press(await screen.findByRole('button', { name: ar.dashboard.profilePreview }));
    await waitFor(() => expect(result.getPathname()).toBe('/account/profile/preview'));
  });

  it('says how many companies looked, once somebody has', async () => {
    server.on('POST /rest/v1/rpc/candidate_summary', { profile_views_30d: 3 });
    open();
    expect(await screen.findByText(/شركات فتحوا ملفك/)).toBeTruthy();
  });

  it('explains a visit sent here from the directory', async () => {
    open('?notice=directory');
    expect(await screen.findByText(ar.agents.deniedNotice)).toBeTruthy();
  });
});

describe('the sales record', () => {
  it('saves the objective and the figures, in either set of digits', async () => {
    open();
    fireEvent.changeText(await screen.findByLabelText(ar.cv.unitsClosed), '12');
    fireEvent.changeText(screen.getByLabelText(ar.cv.volumeEgp), '٣٠٠٠٠٠٠');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save })[1]);
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/saveProfileRecord')).toEqual({
        input: { summaryAr: null, unitsClosed: 12, volumeEgp: 3000000 },
      }),
    );
  });
});

describe('the CV sections', () => {
  it('adds a job from a sheet, dated by its month', async () => {
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.company), 'سيتي سكيب');
    fireEvent.changeText(screen.getByLabelText(ar.cv.jobTitle), 'مدير مبيعات');
    fireEvent.changeText(screen.getByLabelText(ar.cv.started), '2023-05');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save }).at(-1)!);

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/saveExperience')).toEqual({
        input: {
          agentId: AGENT_ID,
          companyName: 'سيتي سكيب',
          title: 'مدير مبيعات',
          track: null,
          started: '2023-05-01',
          ended: null,
          highlights: null,
        },
      }),
    );
  });

  it('edits an entry without moving a date nobody touched', async () => {
    open();
    fireEvent.press(await screen.findByRole('button', { name: `${ar.app.profile.edit}: ${job.title} · ${job.company_name}` }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.jobTitle), 'مدير فريق مبيعات');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save }).at(-1)!);

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/saveExperience')?.input).toMatchObject({
        id: job.id,
        title: 'مدير فريق مبيعات',
        started: '2021-03-15',
      }),
    );
  });

  it('catches an end before the start, before sending anything', async () => {
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.company), 'سيتي سكيب');
    fireEvent.changeText(screen.getByLabelText(ar.cv.jobTitle), 'مدير مبيعات');
    fireEvent.changeText(screen.getByLabelText(ar.cv.started), '2023-05');
    fireEvent.changeText(screen.getByLabelText(ar.cv.ended), '2022-01');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save }).at(-1)!);
    expect(await screen.findByText(ar.app.profile.endBeforeStart)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/saveExperience')).toHaveLength(0);
  });

  it('deletes an entry after asking', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    open();
    fireEvent.press(await screen.findByRole('button', { name: `${ar.common.delete}: ${job.title} · ${job.company_name}` }));
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    act(() => buttons.find((button) => button.style === 'destructive')?.onPress?.());
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/deleteCvEntry')).toEqual({ input: { section: 'experience', id: job.id } }),
    );
    alert.mockRestore();
  });
});

describe('a restricted profile', () => {
  beforeEach(() => {
    agent = { ...baseAgent, restricted_at: '2026-09-20T10:00:00Z', restriction_reason: 'صورة غير مناسبة' };
  });

  it('says it is hidden and why, and takes a request for a second look', async () => {
    open();
    expect(await screen.findByText(`${ar.dashboard.profileRestricted} «صورة غير مناسبة»`)).toBeTruthy();

    fireEvent.press(await screen.findByRole('button', { name: ar.appeals.ask }));
    fireEvent.changeText(screen.getByLabelText(ar.appeals.label), 'قصير');
    fireEvent.press(screen.getByRole('button', { name: ar.appeals.send }));
    expect(await screen.findByText(ar.appeals.messageRequired)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(ar.appeals.label), 'دي صورتي الشخصية من يوم التخرج، مش إعلان.');
    fireEvent.press(screen.getByRole('button', { name: ar.appeals.send }));
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/submitAppeal')).toEqual({
        input: { subjectType: 'agent', subjectId: AGENT_ID, message: 'دي صورتي الشخصية من يوم التخرج، مش إعلان.' },
      }),
    );
    expect(await screen.findByText(ar.appeals.sent)).toBeTruthy();
  });

  it("says why an appeal was refused, in the website's words", async () => {
    server.on('POST /api/mobile/v1/actions/submitAppeal', { ok: false, error: 'appeal_too_soon' });
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.appeals.ask }));
    fireEvent.changeText(screen.getByLabelText(ar.appeals.label), 'دي صورتي الشخصية من يوم التخرج، مش إعلان.');
    fireEvent.press(screen.getByRole('button', { name: ar.appeals.send }));
    expect(await screen.findByText(ar.appeals.tooSoon)).toBeTruthy();
  });

  it('offers nothing when the database cannot say whether appealing is possible', async () => {
    server.on('POST /rest/v1/rpc/my_appeal_state', { status: 404, body: { code: 'PGRST202', message: 'no function' } });
    open();
    expect(await screen.findByText(`${ar.dashboard.profileRestricted} «صورة غير مناسبة»`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.appeals.ask })).toBeNull();
  });
});
