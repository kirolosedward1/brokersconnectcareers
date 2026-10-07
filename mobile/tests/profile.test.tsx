import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert, Modal, Pressable, Text, type AlertButton } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { AgentExperienceRow, AgentProfileRow } from '@/lib/supabase/database.types';
import { monthNames } from '~/components/ui/month-field';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as ProfileScreen from '../src/app/(tabs)/(account)/account/profile';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { newCairo } from './fixtures';
import { placeViewsAt } from './measure';
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
  server.on('GET /rest/v1/agent_profiles', (url: URL) => {
    // Asked whether the profile points at a file: by its path.
    const path = url.searchParams.get('cv_path');
    if (path) return agent && `eq.${agent.cv_path}` === path ? [agent] : [];
    return agent ? [agent] : [];
  });
  server.on('GET /rest/v1/applications', []);
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

/** What applying in another tab does: the account read again. */
function ReadAgain() {
  const queryClient = useQueryClient();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="read the account again"
      onPress={() => void queryClient.invalidateQueries({ queryKey: ['viewer'] })}
    />
  );
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
              <ReadAgain />
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
    expect(await screen.findByText('اكتمال الملف 45٪')).toBeTruthy();
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

  it('keeps up with the name and number the account holds now, without touching what is being typed', async () => {
    let me = { ...profile };
    server.on('/rest/v1/profiles', () => [me]);
    open();
    expect((await screen.findByLabelText(ar.onboarding.fullName)).props.value).toBe(profile.full_name);
    fireEvent.changeText(screen.getByLabelText(ar.agents.headlineAr), 'مستشارة مبيعات أولية');

    // Applied from another tab with a new name and number: the account holds them now.
    me = { ...me, full_name: 'سارة عادل محمود', whatsapp_phone: '+201009998887' };
    fireEvent.press(screen.getByRole('button', { name: 'read the account again' }));
    await waitFor(() => expect(screen.getByLabelText(ar.onboarding.fullName).props.value).toBe('سارة عادل محمود'));
    expect(screen.getByLabelText(ar.onboarding.whatsapp).props.value).toBe('+201009998887');
    expect(screen.getByLabelText(ar.agents.headlineAr).props.value).toBe('مستشارة مبيعات أولية');

    // A number being typed is kept when the account changes under it.
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.whatsapp), '+201112223334');
    me = { ...me, whatsapp_phone: '+201005556667' };
    fireEvent.press(screen.getByRole('button', { name: 'read the account again' }));
    await waitFor(() => expect(server.asked('/rest/v1/profiles').length).toBeGreaterThan(2));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByLabelText(ar.onboarding.whatsapp).props.value).toBe('+201112223334');

    fireEvent.press(saveButton());
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/saveAgentProfile')?.input).toMatchObject({
        fullName: 'سارة عادل محمود',
        whatsapp: '+201112223334',
        headlineAr: 'مستشارة مبيعات أولية',
      }),
    );
  });

  it('keeps up with the account after a save the website stored in its own form', async () => {
    let me = { ...profile };
    server.on('/rest/v1/profiles', () => [me]);
    // As the website stores them: the number in international form, the name trimmed.
    server.on('POST /api/mobile/v1/actions/saveAgentProfile', (_url: URL, init?: RequestInit) => {
      const { input } = JSON.parse(String(init?.body)) as { input: { fullName: string; whatsapp: string } };
      me = { ...me, full_name: input.fullName.trim(), whatsapp_phone: input.whatsapp.replace(/^0/, '+20') };
      return { ok: true };
    });
    open();
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.whatsapp), '01009998887');
    fireEvent.press(saveButton());
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(ar.onboarding.whatsapp).props.value).toBe('+201009998887'));

    // Applied from another tab with another number since.
    me = { ...me, whatsapp_phone: '+201005556667' };
    fireEvent.press(screen.getByRole('button', { name: 'read the account again' }));
    await waitFor(() => expect(screen.getByLabelText(ar.onboarding.whatsapp).props.value).toBe('+201005556667'));
    fireEvent.changeText(screen.getByLabelText(ar.agents.headlineAr), 'مستشارة مبيعات أولية');
    fireEvent.press(saveButton());
    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/saveAgentProfile', 1)?.input).toMatchObject({ whatsapp: '+201005556667' }));
  });

  it("keeps a choice put back while the save's answer is being read again", async () => {
    open();
    fireEvent.press(await screen.findByRole('radio', { name: new RegExp(ar.visibility.public) }));
    // The profile, read again after the save, held as on a slow connection.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.on('GET /rest/v1/agent_profiles', async () => {
      await gate;
      return agent ? [{ ...agent, visibility: 'public' }] : [];
    });
    fireEvent.press(saveButton());
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();

    // Put back before that read is in.
    const verified = () => screen.getByRole('radio', { name: new RegExp(ar.visibility.verified_employers_only) });
    fireEvent.press(verified());
    await act(async () => release());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(verified().props.accessibilityState).toMatchObject({ checked: true });
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

  it('keeps a new CV the profile was saved with, when a later step of the save is refused', async () => {
    // The row goes in with the new file; the developer tags after it are refused.
    server.on('POST /api/mobile/v1/actions/saveAgentProfile', (_url: URL, init: RequestInit | undefined) => {
      const sent = (JSON.parse(String(init?.body)) as { input: { cvPath: string } }).input;
      agent = agent ? { ...agent, cv_path: sent.cvPath } : agent;
      return { ok: false, error: 'insert or update on table "agent_developers" violates foreign key constraint' };
    });
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/cv.pdf', name: 'cv.pdf', mimeType: 'application/pdf', size: 2048, lastModified: 0 }],
    } as DocumentPicker.DocumentPickerResult);
    open();

    fireEvent.press(await screen.findByRole('button', { name: ar.app.apply.pickCv }));
    expect(await screen.findByText('cv.pdf')).toBeTruthy();
    fireEvent.press(saveButton());

    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/saveAgentProfile')).toHaveLength(1));
    const path = String(bodyOf('/api/mobile/v1/actions/saveAgentProfile')?.input?.cvPath);
    // Asked, and the saved profile points at it: not taken out from under it.
    await waitFor(() => expect(server.asked('/rest/v1/agent_profiles').some((request) => request.url.searchParams.get('cv_path') === `eq.${path}`)).toBe(true));
    await act(async () => {});
    expect(server.asked('/storage/v1/object/cvs')).toHaveLength(0);
  });

  it('catches a phone number the website would refuse, before sending anything — in view and said, far above Save', async () => {
    const announce = AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock;
    announce.mockClear();
    const layout = placeViewsAt(700);
    try {
      open();
      fireEvent.changeText(await screen.findByLabelText(ar.onboarding.whatsapp), '12');
      fireEvent.press(saveButton());
      expect(await screen.findByText(ar.validation.invalidPhone)).toBeTruthy();
      expect(server.asked('/api/mobile/v1/actions/saveAgentProfile')).toHaveLength(0);
      expect(announce).toHaveBeenCalledWith(ar.validation.invalidPhone, { queue: true });
      await waitFor(() => expect(layout.scrollTo).toHaveBeenCalledWith({ y: 700 - 16, animated: true }));
    } finally {
      layout.undo();
    }
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

/** A month picked as a reader does: the field, then its year, then the month. */
function pickMonth(field: string, year: number, month: number) {
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${field}: `) }));
  fireEvent.press(screen.getByRole('radio', { name: String(year) }));
  fireEvent.press(screen.getByRole('radio', { name: `${monthNames('ar')[month - 1]} ${year}` }));
}

describe('the CV sections', () => {
  it('adds a job from a sheet, dated by its month', async () => {
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.company), 'سيتي سكيب');
    fireEvent.changeText(screen.getByLabelText(ar.cv.jobTitle), 'مدير مبيعات');
    pickMonth(ar.cv.started, 2023, 5);
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

  it('adds a job once when the answer is lost, and keeps the sheet when it did not go in', async () => {
    let stored = [job];
    // What the table holds, by the company named in the question.
    server.on('GET /rest/v1/agent_experience', (url: URL) => {
      const company = url.searchParams.get('company_name');
      return company ? stored.filter((row) => `eq.${row.company_name}` === company) : stored;
    });
    // The website stores what was sent, cleaned, and its answer never reaches the phone.
    server.on('POST /api/mobile/v1/actions/saveExperience', (_url: URL, init?: RequestInit) => {
      const { input } = JSON.parse(String(init?.body)) as {
        input: { companyName: string; title: string; track: null; started: string; ended: null; highlights: null };
      };
      stored = [
        ...stored,
        {
          ...job,
          id: '0e000000-0000-4000-8000-000000000002',
          company_name: input.companyName.trim(),
          title: input.title.trim(),
          track: input.track,
          started: input.started,
          ended: input.ended,
          highlights: input.highlights,
        },
      ];
      throw new TypeError('Network request failed');
    });
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.company), '  سيتي سكيب ');
    fireEvent.changeText(screen.getByLabelText(ar.cv.jobTitle), 'مدير مبيعات');
    pickMonth(ar.cv.started, 2023, 5);
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save }).at(-1)!);

    // The database has it: the sheet closes, and nothing is sent twice.
    await waitFor(() => expect(screen.queryByLabelText(ar.cv.company)).toBeNull());
    expect(server.asked('/api/mobile/v1/actions/saveExperience')).toHaveLength(1);

    // One that did not go in stays in the sheet, with the reason.
    server.on('POST /api/mobile/v1/actions/saveExperience', () => {
      throw new TypeError('Network request failed');
    });
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.company), 'بالم هيلز');
    fireEvent.changeText(screen.getByLabelText(ar.cv.jobTitle), 'مستشار مبيعات');
    pickMonth(ar.cv.started, 2022, 1);
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save }).at(-1)!);
    expect(await screen.findByText(ar.app.offline.body)).toBeTruthy();
    expect(screen.getByLabelText(ar.cv.company).props.value).toBe('بالم هيلز');
  });

  it('does not take an entry that was already there for the one whose answer was lost', async () => {
    // Cairo University is on the profile already, for another field of study.
    const law = { id: '0f000000-0000-4000-8000-000000000001', agent_id: AGENT_ID, institution: 'جامعة القاهرة', degree: null, field: 'تجارة', graduated: null, sort_order: 0, created_at: '2026-09-01T10:00:00Z' };
    server.on('GET /rest/v1/agent_education', (url: URL) =>
      url.searchParams.get('institution') === `eq.${law.institution}` || !url.searchParams.get('institution') ? [law] : [],
    );
    // The website refuses with a server error and writes nothing.
    server.on('POST /api/mobile/v1/actions/saveEducation', { status: 500, body: { error: 'failed' } });
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addEducation }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.institution), 'جامعة القاهرة');
    fireEvent.changeText(screen.getByLabelText(ar.cv.field), 'حقوق');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save }).at(-1)!);

    // Not saved, and not said to be: the sheet stays with what was typed.
    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.getByLabelText(ar.cv.field).props.value).toBe('حقوق');
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

  it('catches an end before the start, before sending anything — in view in the sheet, and said', async () => {
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.company), 'سيتي سكيب');
    fireEvent.changeText(screen.getByLabelText(ar.cv.jobTitle), 'مدير مبيعات');
    pickMonth(ar.cv.started, 2023, 5);
    pickMonth(ar.cv.ended, 2022, 1);
    const announce = AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock;
    announce.mockClear();
    const layout = placeViewsAt(320);
    try {
      fireEvent.press(screen.getAllByRole('button', { name: ar.common.save }).at(-1)!);
      expect(await screen.findByText(ar.app.profile.endBeforeStart)).toBeTruthy();
      expect(server.asked('/api/mobile/v1/actions/saveExperience')).toHaveLength(0);
      expect(announce).toHaveBeenCalledWith(ar.app.profile.endBeforeStart, { queue: true });
      await waitFor(() => expect(layout.scrollTo).toHaveBeenCalledWith({ y: 320 - 16, animated: true }));
    } finally {
      layout.undo();
    }
  });

  it('asks before an entry typed into the sheet is thrown away, by its X or by pulling the sheet down', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    open();
    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    // Nothing typed: it simply closes.
    fireEvent.press(await screen.findByRole('button', { name: ar.common.close }));
    expect(alert).not.toHaveBeenCalled();

    fireEvent.press(await screen.findByRole('button', { name: ar.cv.addExperience }));
    fireEvent.changeText(await screen.findByLabelText(ar.cv.company), 'سيتي سكيب');
    // The sheet pulled down: iOS asks the modal to close.
    const sheet = screen.UNSAFE_getAllByType(Modal).find((modal) => modal.props.visible);
    act(() => sheet?.props.onRequestClose());
    expect(alert).toHaveBeenCalledWith(ar.app.leave.title, ar.app.leave.body, expect.any(Array));
    // Kept: the sheet and what was typed are still there.
    const stay = (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.style === 'cancel');
    act(() => stay?.onPress?.());
    expect(screen.getByLabelText(ar.cv.company).props.value).toBe('سيتي سكيب');
    alert.mockRestore();
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
