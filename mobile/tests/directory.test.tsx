import type { ReactNode } from 'react';
import { Alert, Linking, Pressable, type AlertButton } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTranslator } from 'use-intl';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { formatNumber, intlFormats } from '@/lib/format';
import type { AgentDirectoryResponse } from '@/lib/mobile-api/reads';
import type {
  AgentCardDetail,
  AgentCardRow,
  AgentExperienceRow,
  AgentProfileRow,
  CompanyRow,
  ProfileRow,
  SavedAgentCardRow,
} from '@/lib/supabase/database.types';
import { unhideAgent } from '~/features/moderation/hidden-agents';
import { useSaveRecord } from '~/features/profile/queries';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AgentScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/agents/[slug]';
import * as PreviewScreen from '../src/app/(tabs)/(account)/account/profile/preview';
import * as HiddenScreen from '../src/app/(tabs)/(account)/account/hidden';
import * as DirectoryScreen from '../src/app/(tabs)/(consultants)/agents/index';
import * as ShortlistScreen from '../src/app/(tabs)/(consultants)/employer/talent';
import { authSession, authUser, mobileConfig, ownedCompany, profile, USER_ID } from './auth-fixtures';
import { cairo, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  The consultant directory on the phone — the search, a consultant's page and
  the company's shortlist — and the candidate's own card as companies see it,
  as the real screens draw them against stand-ins for Supabase and the
  website: what is asked for, what is shown to whom, and the website's words
  for each refusal.
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
const CONSULTANT = '9a000000-0000-4000-8000-000000000009';

const mona: AgentCardRow = {
  id: 'a1000000-0000-4000-8000-000000000001',
  slug: 'mona-ali',
  is_unlocked: true,
  full_name: 'منى علي',
  avatar_url: null,
  headline_ar: 'مديرة مبيعات ريسيل في التجمع',
  headline_en: null,
  years_experience: 7,
  tracks: ['resale'],
  district_ids: [newCairo.id],
  languages: ['ar', 'en'],
  availability: 'actively_searching',
  total_count: 2,
};

/** A card this company may not see yet: opened by its id, since the slug would spell the name. */
const locked: AgentCardRow = {
  id: 'a2000000-0000-4000-8000-000000000002',
  slug: 'a2000000-0000-4000-8000-000000000002',
  is_unlocked: false,
  full_name: null,
  avatar_url: null,
  headline_ar: 'مستشار مبيعات أولي',
  headline_en: null,
  years_experience: 3,
  tracks: ['primary'],
  district_ids: [],
  languages: ['ar'],
  availability: 'open_to_offers',
  total_count: 2,
};

const monaCard: AgentCardDetail = {
  id: mona.id,
  slug: mona.slug,
  is_unlocked: true,
  full_name: mona.full_name,
  avatar_url: null,
  headline_ar: mona.headline_ar,
  headline_en: null,
  years_experience: 7,
  tracks: ['resale'],
  district_ids: [newCairo.id],
  languages: ['ar', 'en'],
  availability: 'actively_searching',
  developer_ids: [3],
  has_cv: true,
  can_reveal: true,
};

const experience = {
  id: 'e1',
  agent_id: mona.id,
  company_name: 'نايل بروكرز',
  title: 'مديرة مبيعات',
  track: 'resale',
  district_id: newCairo.id,
  started: '2021-03-01',
  ended: null,
  highlights: 'قفلت ٤٠ وحدة في سنة.',
  sort_order: 0,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
} as AgentExperienceRow;

const employerProfile: ProfileRow = { ...profile, role: 'employer', full_name: 'أحمد سمير' };
const verified: CompanyRow = { ...ownedCompany, verification_status: 'verified' };

let me: ProfileRow;
let company: CompanyRow | null;
let kept: string[];
let card: AgentCardDetail | null;
let about: Pick<AgentProfileRow, 'summary_ar' | 'summary_en' | 'units_closed' | 'volume_egp' | 'user_id' | 'visibility'>;
let shortlistRows: SavedAgentCardRow[];

function directory(agents: AgentCardRow[] = [mona, locked]): AgentDirectoryResponse {
  return { agents, total: agents.length, pageCount: 1, page: 1 };
}

const warnings: string[] = [];
beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
  warnings.length = 0;
});

beforeEach(async () => {
  me = { ...employerProfile };
  company = { ...verified };
  kept = [];
  card = { ...monaCard };
  about = {
    summary_ar: 'بدوّر على شركة بتشتغل ريسيل في شرق القاهرة.',
    summary_en: null,
    units_closed: 40,
    volume_egp: 120_000_000,
    user_id: CONSULTANT,
    visibility: 'public',
  };
  shortlistRows = [];
  jest.mocked(WebBrowser.openBrowserAsync).mockClear();

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('/rest/v1/profiles', () => [me]);
  server.on('POST /rest/v1/rpc/my_company_id', () => company?.id ?? null);
  server.on('GET /rest/v1/companies', () => (company ? [company] : []));
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/rest/v1/developers', [{ id: 3, name_ar: 'بالم هيلز', name_en: 'Palm Hills', slug: 'palm-hills' }]);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('GET /api/mobile/v1/agents', () => directory());
  server.on('GET /rest/v1/saved_agents', () => kept.map((agent_id) => ({ agent_id })));
  server.on('POST /api/mobile/v1/actions/toggleSavedAgent', (_url: URL, init?: RequestInit) => {
    const agentId = (JSON.parse(String(init?.body)) as { input: { agentId: string } }).input.agentId;
    kept = kept.includes(agentId) ? kept.filter((id) => id !== agentId) : [...kept, agentId];
    return { ok: true, data: { saved: kept.includes(agentId) } };
  });
  server.on('POST /rest/v1/rpc/get_agent_card', () => (card ? [card] : []));
  server.on('GET /rest/v1/agent_experience', () => [experience]);
  server.on('GET /rest/v1/agent_education', []);
  server.on('GET /rest/v1/agent_certifications', []);
  server.on('GET /rest/v1/agent_profiles', () => [about]);
  server.on('POST /api/mobile/v1/actions/recordAgentView', { ok: true });
  server.on('POST /api/mobile/v1/actions/revealAgentContact', {
    ok: true,
    data: { fullName: 'منى علي', phone: '+201001112223', whatsappUrl: 'https://wa.me/201001112223?text=hi', hasCv: true },
  });
  server.on('GET /api/agent-cv/mona-ali', { url: 'https://storage.example/cv.pdf?token=1' });
  server.on('POST /rest/v1/rpc/saved_agent_cards', () => shortlistRows);
  server.on('GET /rest/v1/company_documents', []);
  server.on('GET /rest/v1/company_members', () => [
    { user_id: USER_ID, role: 'recruiter', created_at: '2026-09-01T10:00:00Z', profile: { full_name: 'أحمد سمير' } },
  ]);

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: me.role, approval_status: 'approved' }, company: null });
  server.requests.length = 0;
});

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

/** An edit to the profile from its own screen, on the same cache. */
let withEdit = false;
function ProfileEdit() {
  const save = useSaveRecord();
  return <Pressable accessibilityRole="button" accessibilityLabel="edit the profile" onPress={() => save.mutate({ summaryAr: 'هدفي الجديد' })} />;
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
              {withEdit ? <ProfileEdit /> : null}
            </Settled>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const app = {
  _layout: Root,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/(consultants)/agents/index': DirectoryScreen,
  '(tabs)/(consultants)/agents/[slug]': AgentScreen,
  '(tabs)/(consultants)/employer/talent': ShortlistScreen,
  '(tabs)/(account)/account/profile/preview': PreviewScreen,
  '(tabs)/(account)/account/hidden': HiddenScreen,
};

const input = (path: string, index = 0) => (server.asked(path)[index]?.body as { input: Record<string, unknown> } | undefined)?.input;

/** A shortlist control once the shortlist has been read: until then it waits, since the website toggles. */
async function ready(name: string) {
  await waitFor(() => expect(screen.getAllByRole('button', { name })[0].props.accessibilityState?.busy).toBeFalsy());
  return screen.getAllByRole('button', { name });
}

describe('the directory, for a verified company', () => {
  it('shows the cards as the database answers them: named when open, anonymous and locked when not', async () => {
    renderRouter(app, { initialUrl: '/agents' });

    expect(await screen.findByText('منى علي')).toBeTruthy();
    expect(screen.getByText(ar.agents.anonymous)).toBeTruthy();
    expect(screen.getByText('مديرة مبيعات ريسيل في التجمع')).toBeTruthy();
    // A verified company is not told about the gate.
    expect(screen.queryByText(ar.agents.locked)).toBeNull();
    // Asked with the reader's token: what each card shows depends on who asks.
    const asked = server.asked('/api/mobile/v1/agents')[0];
    expect(asked).toBeTruthy();
  });

  it('keeps a consultant from the card, and offers it only on an open one', async () => {
    renderRouter(app, { initialUrl: '/agents' });

    await screen.findAllByRole('button', { name: ar.agents.shortlistAdd });
    const keep = await ready(ar.agents.shortlistAdd);
    // One open card, one locked: the locked one cannot be kept.
    expect(keep).toHaveLength(1);
    fireEvent.press(keep[0]);
    await waitFor(() => expect(input('/api/mobile/v1/actions/toggleSavedAgent')).toEqual({ agentId: mona.id }));
    expect(await screen.findByRole('button', { name: ar.agents.shortlistRemove })).toBeTruthy();
  });

  it('opens a card by its slug, and a locked one by its id', async () => {
    const result = renderRouter(app, { initialUrl: '/agents' });
    fireEvent.press(await screen.findByLabelText(new RegExp(`^${ar.agents.anonymous}`)));
    await waitFor(() => expect(result.getPathname()).toBe(`/agents/${locked.id}`));
  });

  it('reads its filters from the address and sends them as the website writes them', async () => {
    renderRouter(app, { initialUrl: '/agents?track=resale&availability=actively_searching&years=5' });

    await screen.findByText('منى علي');
    const url = server.asked('/api/mobile/v1/agents')[0].url;
    expect(url.searchParams.getAll('track')).toEqual(['resale']);
    expect(url.searchParams.get('availability')).toBe('actively_searching');
    expect(url.searchParams.get('years')).toBe('5');
    // Each filter in use is a chip that takes it off.
    fireEvent.press(screen.getByRole('button', { name: ar.jobs.removeFilter.replace('{name}', ar.track.resale) }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/agents').at(-1)?.url.searchParams.has('track')).toBe(false));
  });

  it('applies what the filter sheet chose in one go', async () => {
    renderRouter(app, { initialUrl: '/agents' });

    fireEvent.press(await screen.findByRole('button', { name: ar.jobs.filters }));
    fireEvent.press(await screen.findByRole('radio', { name: ar.availability.actively_searching }));
    fireEvent.press(screen.getByRole('button', { name: ar.track.rental }));
    fireEvent.press(screen.getByRole('button', { name: newCairo.name_ar }));
    fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${ar.filters.showResults}`) }));

    await waitFor(() => {
      const url = server.asked('/api/mobile/v1/agents').at(-1)?.url;
      expect(url?.searchParams.get('availability')).toBe('actively_searching');
      expect(url?.searchParams.getAll('track')).toEqual(['rental']);
      expect(url?.searchParams.getAll('district')).toEqual([newCairo.slug]);
    });
  });

  it('says the directory is empty yet, not that a search found nothing, when nothing narrows it', async () => {
    server.on('GET /api/mobile/v1/agents', () => directory([]));
    renderRouter(app, { initialUrl: '/agents' });

    expect(await screen.findByText(ar.agents.emptyDirectory)).toBeTruthy();
    expect(screen.getByText(ar.agents.emptyDirectoryHint)).toBeTruthy();
    expect(screen.queryByText(ar.agents.empty)).toBeNull();
    expect(screen.queryByText(ar.agents.emptyHint)).toBeNull();
  });

  it('says nobody matched, and offers to clear what is narrowing it', async () => {
    server.on('GET /api/mobile/v1/agents', () => directory([]));
    renderRouter(app, { initialUrl: '/agents?q=xyz' });

    expect(await screen.findByText(ar.agents.empty)).toBeTruthy();
    expect(screen.getByText(ar.agents.emptyHint)).toBeTruthy();
    fireEvent.press(screen.getAllByRole('button', { name: ar.jobs.clearFilters })[0]);
    await waitFor(() => expect(server.asked('/api/mobile/v1/agents').at(-1)?.url.searchParams.has('q')).toBe(false));
  });
});

describe('the directory, for a company not verified yet', () => {
  it('explains the gate once, and tells a recruiter who can open it', async () => {
    company = { ...verified, verification_status: 'unverified' };
    renderRouter(app, { initialUrl: '/agents' });

    expect(await screen.findByText(ar.agents.locked)).toBeTruthy();
    expect(await screen.findByText(ar.agents.lockedRecruiter)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.agents.lockedCta })).toBeNull();
  });
});

describe('the search over the directory', () => {
  it('searches the words typed, and the clear mark drops them', async () => {
    renderRouter(app, { initialUrl: '/agents' });
    await screen.findByText('منى علي');

    // The app's own field (tests/search-field.test.tsx): iOS's search bar ran left to right on a phone set to English.
    const field = screen.getByLabelText(ar.filters.search);
    expect(field.props.placeholder).toBe(ar.agents.searchPlaceholder);
    fireEvent.changeText(field, '  مدير مبيعات  ');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(server.asked('/api/mobile/v1/agents').at(-1)?.url.searchParams.get('q')).toBe('مدير مبيعات'));
    expect(await screen.findByRole('button', { name: ar.jobs.removeFilter.replace('{name}', '«مدير مبيعات»') })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: ar.app.search.clear }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/agents').at(-1)?.url.searchParams.has('q')).toBe(false));
    expect(screen.getByLabelText(ar.filters.search).props.value).toBe('');
    expect(screen.queryByRole('button', { name: ar.app.search.clear })).toBeNull();
  });

  it('shows the words a link carries, and empties once their chip is taken off', async () => {
    renderRouter(app, { initialUrl: '/agents?q=ريسيل' });
    await screen.findByText('منى علي');
    expect(screen.getByLabelText(ar.filters.search).props.value).toBe('ريسيل');

    fireEvent.press(screen.getByRole('button', { name: ar.jobs.removeFilter.replace('{name}', '«ريسيل»') }));
    await waitFor(() => expect(screen.getByLabelText(ar.filters.search).props.value).toBe(''));
  });
});

describe('the directory, for a company whose account is not approved yet', () => {
  let navigate: jest.SpyInstance | null = null;
  afterEach(() => {
    navigate?.mockRestore();
    navigate = null;
  });

  beforeEach(async () => {
    me = { ...employerProfile, approval_status: 'pending' };
    await rememberActor({
      userId: USER_ID,
      profile: { role: 'employer', approval_status: 'pending' },
      company: { id: ownedCompany.id, verification_status: 'unverified' },
    });
  });

  it("says the consultants open once the company is verified, and takes its admin to the papers", async () => {
    company = { ...verified, verification_status: 'unverified' };
    server.on('GET /rest/v1/company_members', () => [
      { user_id: USER_ID, role: 'admin', created_at: '2026-09-01T10:00:00Z', profile: { full_name: 'أحمد سمير' } },
    ]);
    navigate = jest.spyOn(router, 'navigate').mockImplementation(() => {});
    renderRouter(app, { initialUrl: '/agents' });

    expect(await screen.findByText(ar.app.directory.verifyTitle)).toBeTruthy();
    expect(screen.getByText(ar.app.directory.verifyBody)).toBeTruthy();
    // Nothing asked of the directory, and nothing to search in it.
    expect(server.asked('/api/mobile/v1/agents')).toHaveLength(0);
    expect(screen.queryByLabelText(ar.filters.search)).toBeNull();

    fireEvent.press(await screen.findByRole('button', { name: ar.agents.lockedCta }));
    expect(navigate).toHaveBeenCalledWith('/employer/company');
    expect(screen.queryByText(ar.agents.lockedRecruiter)).toBeNull();
  });

  it('tells a recruiter who can verify the company, with no button of their own', async () => {
    company = { ...verified, verification_status: 'unverified' };
    renderRouter(app, { initialUrl: '/agents' });

    expect(await screen.findByText(ar.app.directory.verifyTitle)).toBeTruthy();
    expect(screen.getByText(ar.app.directory.verifyBody)).toBeTruthy();
    expect(await screen.findByText(ar.agents.lockedRecruiter)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.agents.lockedCta })).toBeNull();
  });

  it('says a verified company opens it once the account is reviewed', async () => {
    company = { ...verified };
    await rememberActor({
      userId: USER_ID,
      profile: { role: 'employer', approval_status: 'pending' },
      company: { id: ownedCompany.id, verification_status: 'verified' },
    });
    renderRouter(app, { initialUrl: '/agents' });

    expect(await screen.findByText(ar.employer.pendingTitle)).toBeTruthy();
    expect(screen.getByText(ar.app.directory.reviewing)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.agents.lockedCta })).toBeNull();
  });
});

describe("a consultant's page", () => {
  it('shows the card and the CV the database lets this company see, and records that the company looked', async () => {
    renderRouter(app, { initialUrl: '/agents/mona-ali' });

    expect(await screen.findByText('منى علي')).toBeTruthy();
    expect(screen.getByText(ar.availability.actively_searching)).toBeTruthy();
    expect(screen.getByText(ar.track.resale)).toBeTruthy();
    expect(screen.getByText(newCairo.name_ar)).toBeTruthy();
    expect(screen.getByText('بالم هيلز')).toBeTruthy();
    expect(screen.getByText(ar.language.en)).toBeTruthy();
    expect(screen.getByText('بدوّر على شركة بتشتغل ريسيل في شرق القاهرة.')).toBeTruthy();
    expect(screen.getByText(ar.cv.recordHint)).toBeTruthy();
    expect(screen.getByText('مديرة مبيعات')).toBeTruthy();
    expect(screen.getByText('قفلت ٤٠ وحدة في سنة.')).toBeTruthy();

    await waitFor(() => expect(input('/api/mobile/v1/actions/recordAgentView')).toEqual({ slug: 'mona-ali' }));
    // No number on the page until somebody asks.
    expect(screen.queryByText('+201001112223')).toBeNull();
    expect(screen.getByRole('button', { name: ar.agents.report })).toBeTruthy();
  });

  it('asks for the number on a press, then offers WhatsApp and the CV', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderRouter(app, { initialUrl: '/agents/mona-ali' });

    fireEvent.press(await screen.findByRole('button', { name: ar.agents.revealContact }));
    await waitFor(() => expect(input('/api/mobile/v1/actions/revealAgentContact')).toEqual({ handle: 'mona-ali', locale: 'ar' }));
    expect(await screen.findByText('+201001112223')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: ar.agents.contact }));
    expect(openURL).toHaveBeenCalledWith('https://wa.me/201001112223?text=hi');

    fireEvent.press(screen.getByRole('button', { name: ar.agents.downloadCv }));
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://storage.example/cv.pdf?token=1'));
    openURL.mockRestore();
  });

  it("says which kind of no it was: too many for now, or not open to this company", async () => {
    server.on('POST /api/mobile/v1/actions/revealAgentContact', { ok: false, error: 'rate_limit', retryAfterSeconds: 1800 });
    renderRouter(app, { initialUrl: '/agents/mona-ali' });

    fireEvent.press(await screen.findByRole('button', { name: ar.agents.revealContact }));
    expect(await screen.findByText(/30/)).toBeTruthy();

    server.on('POST /api/mobile/v1/actions/revealAgentContact', { ok: false, error: 'locked' });
    await waitFor(() => expect(screen.getByRole('button', { name: ar.agents.revealContact }).props.accessibilityState?.busy).toBe(false));
    fireEvent.press(screen.getByRole('button', { name: ar.agents.revealContact }));
    expect(await screen.findByText(ar.agents.revealLocked)).toBeTruthy();
  });

  it('keeps the consultant from the page, and puts the button back when the website refuses', async () => {
    renderRouter(app, { initialUrl: '/agents/mona-ali' });

    await screen.findByRole('button', { name: ar.agents.shortlistAdd });
    fireEvent.press((await ready(ar.agents.shortlistAdd))[0]);
    expect(await screen.findByRole('button', { name: ar.agents.shortlistRemove })).toBeTruthy();

    server.on('POST /api/mobile/v1/actions/toggleSavedAgent', { ok: false, error: 'not_allowed' });
    await waitFor(() => expect(screen.getByRole('button', { name: ar.agents.shortlistRemove }).props.accessibilityState?.busy).toBe(false));
    fireEvent.press(screen.getByRole('button', { name: ar.agents.shortlistRemove }));
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/toggleSavedAgent')).toHaveLength(2));
    expect(await screen.findByRole('button', { name: ar.agents.shortlistRemove })).toBeTruthy();
  });

  it('keeps a consultant whose answer was lost, rather than putting the button back for a second press to undo', async () => {
    let pressed = false;
    server.on('GET /rest/v1/saved_agents', (url: URL) => {
      // The one consultant asked about, or the whole shortlist — which, after the press, cannot be read.
      const one = url.searchParams.get('agent_id')?.replace(/^eq\./, '');
      if (pressed && !one) return { status: 503, body: { message: 'upstream unavailable' } };
      return kept.filter((id) => !one || id === one).map((agent_id) => ({ agent_id }));
    });
    server.on('POST /api/mobile/v1/actions/toggleSavedAgent', (_url: URL, init?: RequestInit) => {
      pressed = true;
      kept = [...kept, (JSON.parse(String(init?.body)) as { input: { agentId: string } }).input.agentId];
      throw new TypeError('Network request failed');
    });
    renderRouter(app, { initialUrl: '/agents/mona-ali' });

    await screen.findByRole('button', { name: ar.agents.shortlistAdd });
    fireEvent.press((await ready(ar.agents.shortlistAdd))[0]);
    // Read back, the consultant is on it: kept, and not sent twice.
    expect(await screen.findByRole('button', { name: ar.agents.shortlistRemove })).toBeTruthy();
    await ready(ar.agents.shortlistRemove);
    expect(server.asked('/api/mobile/v1/actions/toggleSavedAgent')).toHaveLength(1);
  });

  it('waits for the shortlist before offering to change it: the website toggles', async () => {
    // The shortlist takes its time; the consultant is on it already.
    kept = [mona.id];
    let letGo: () => void = () => {};
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const plain = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/rest/v1/saved_agents')) await held;
      return plain(input, init);
    }) as typeof fetch;
    try {
      renderRouter(app, { initialUrl: '/agents/mona-ali' });
      const button = await screen.findByRole('button', { name: ar.agents.shortlistAdd });
      expect(button.props.accessibilityState?.busy).toBe(true);
      fireEvent.press(button);
      expect(server.asked('/api/mobile/v1/actions/toggleSavedAgent')).toHaveLength(0);
      letGo();
      expect(await screen.findByRole('button', { name: ar.agents.shortlistRemove })).toBeTruthy();
    } finally {
      letGo();
      globalThis.fetch = plain;
    }
  });

  it('shows a locked card without a name or a way to make contact, and the way to open it', async () => {
    card = { ...monaCard, id: locked.id, slug: locked.id, is_unlocked: false, full_name: null, can_reveal: false };
    renderRouter(app, { initialUrl: `/agents/${locked.id}` });

    expect(await screen.findByText(ar.agents.anonymous)).toBeTruthy();
    expect(screen.getByText(ar.agents.lockedBody)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.agents.lockedCta })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.agents.revealContact })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.agents.shortlistAdd })).toBeNull();
  });

  it('is not found when the database has no card for this reader', async () => {
    card = null;
    renderRouter(app, { initialUrl: '/agents/nobody' });
    expect(await screen.findByText(ar.common.notFound)).toBeTruthy();
  });
});

describe('hiding a consultant', () => {
  it('takes them out of the directory on this phone, from their page, which then says so and brings them back', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      renderRouter(app, { initialUrl: '/agents/mona-ali' });
      fireEvent.press(await screen.findByRole('button', { name: ar.app.moderation.hideAgent }));
      expect(alert.mock.calls[0][0]).toBe(ar.app.moderation.hideAgentTitle.replace('{name}', 'منى علي'));
      act(() => (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.style === 'destructive')?.onPress?.());
      expect(await screen.findByText(ar.app.moderation.hiddenAgent)).toBeTruthy();
      expect(screen.queryByRole('button', { name: ar.app.moderation.hideAgent })).toBeNull();

      // The directory, without her; the other consultant is still there.
      act(() => router.navigate('/agents'));
      expect(await screen.findByText(ar.agents.anonymous)).toBeTruthy();
      expect(screen.queryByText('منى علي')).toBeNull();
    } finally {
      act(() => unhideAgent(mona.id));
      alert.mockRestore();
    }
    // Brought back, she is listed again.
    expect(await screen.findByText('منى علي')).toBeTruthy();
  });

  it('counts them out of the directory and the shortlist, and brings them back from Account', async () => {
    const tr = createTranslator({ locale: 'ar', messages: ar, formats: intlFormats, timeZone: 'Africa/Cairo' });
    kept = [mona.id];
    renderRouter(app, { initialUrl: '/agents' });
    expect(await screen.findByText('منى علي')).toBeTruthy();
    expect(screen.getByText(tr('jobs.resultsCount', { count: 2 }))).toBeTruthy();
    expect(await screen.findByLabelText(`${ar.employer.shortlist}: ${formatNumber(1, 'ar')}`)).toBeTruthy();

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      act(() => router.push('/agents/mona-ali'));
      fireEvent.press(await screen.findByRole('button', { name: ar.app.moderation.hideAgent }));
      const confirm = (alert.mock.calls[0][2] as AlertButton[]).find((button) => button.style === 'destructive');
      // His own word in Arabic: the company's "hide it" is feminine.
      expect(confirm?.text).toBe(ar.app.moderation.hideAgentConfirm);
      act(() => confirm?.onPress?.());
      expect(await screen.findByText(ar.app.moderation.hiddenAgent)).toBeTruthy();
    } finally {
      alert.mockRestore();
    }

    // Out of the directory, its total and the shortlist's count alike.
    act(() => router.navigate('/agents'));
    expect(await screen.findByText(tr('jobs.resultsCount', { count: 1 }))).toBeTruthy();
    expect(screen.queryByText('منى علي')).toBeNull();
    expect(screen.getByLabelText(`${ar.employer.shortlist}: ${formatNumber(0, 'ar')}`)).toBeTruthy();

    // Account → "Hidden on this phone": listed by name, and shown again from there.
    act(() => router.push('/account/hidden'));
    expect(await screen.findByText('منى علي')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.app.moderation.showAgainNamed.replace('{name}', 'منى علي') }));
    expect(await screen.findByText(ar.app.moderation.hiddenNothing)).toBeTruthy();

    act(() => router.navigate('/agents'));
    expect(await screen.findByText('منى علي')).toBeTruthy();
    expect(screen.getByText(tr('jobs.resultsCount', { count: 2 }))).toBeTruthy();
  });
});

describe("the company's shortlist", () => {
  const saved = (overrides: Partial<SavedAgentCardRow> = {}): SavedAgentCardRow => ({
    id: mona.id,
    slug: mona.slug,
    is_listed: true,
    is_unlocked: true,
    full_name: 'منى علي',
    avatar_url: null,
    headline_ar: mona.headline_ar,
    headline_en: null,
    years_experience: 7,
    tracks: ['resale'],
    district_ids: [newCairo.id],
    languages: ['ar'],
    availability: 'actively_searching',
    saved_at: '2026-09-20T10:00:00Z',
    saved_by_name: 'أحمد سمير',
    total_count: 2,
    ...overrides,
  });

  it('lists who the company keeps, says who kept them, and lets one go at once', async () => {
    const gone = saved({
      id: locked.id,
      slug: null,
      is_listed: false,
      is_unlocked: false,
      full_name: null,
      headline_ar: null,
      years_experience: null,
      tracks: null,
      district_ids: null,
      availability: null,
      saved_by_name: null,
    });
    shortlistRows = [saved(), gone];
    kept = [mona.id, locked.id];
    renderRouter(app, { initialUrl: '/employer/talent' });

    expect(await screen.findByText('منى علي')).toBeTruthy();
    expect(screen.getByText(new RegExp('أحمد سمير'))).toBeTruthy();
    // Somebody who has left the directory: no name, no link, only that they were kept.
    expect(screen.getByText(ar.employer.shortlistGone)).toBeTruthy();
    expect(screen.getByText(ar.employer.shortlistGoneHint)).toBeTruthy();

    const remove = await screen.findAllByRole('button', { name: ar.agents.shortlistRemove });
    fireEvent.press(remove[0]);
    await waitFor(() => expect(screen.queryByText('منى علي') === null).toBe(true));
    expect(input('/api/mobile/v1/actions/toggleSavedAgent')).toEqual({ agentId: mona.id });
  });

  it('says so when nobody is on it', async () => {
    renderRouter(app, { initialUrl: '/employer/talent' });
    expect(await screen.findByText(ar.employer.shortlistEmpty)).toBeTruthy();
    expect(screen.getByText(ar.employer.shortlistEmptyHint)).toBeTruthy();
  });
});

describe("a candidate's own card", () => {
  beforeEach(async () => {
    me = { ...profile };
    company = null;
    card = { ...monaCard, can_reveal: false };
    about = { ...about, user_id: USER_ID, visibility: 'verified_employers_only' };
    server.on('GET /rest/v1/agent_profiles', (url: URL) =>
      url.searchParams.get('user_id') === `eq.${USER_ID}` ? [{ ...about, id: mona.id, slug: 'mona-ali' }] : [about],
    );
    server.on('GET /rest/v1/agent_developers', []);
    await rememberActor({ userId: USER_ID, profile: { role: 'candidate', approval_status: 'approved' }, company: null });
  });

  it('is shown as companies see it, with who sees what, their own CV, and nothing to report or count', async () => {
    renderRouter(app, { initialUrl: '/account/profile/preview' });

    expect(await screen.findByText(ar.agents.ownerBanner)).toBeTruthy();
    expect(screen.getByText(ar.agents.ownerVerified)).toBeTruthy();
    expect(screen.getByText(ar.agents.ownerEdit)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.agents.downloadCv })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.agents.revealContact })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.agents.shortlistAdd })).toBeNull();
    expect(screen.queryByRole('button', { name: ar.agents.report })).toBeNull();
    // A candidate has no company: nothing to record.
    await act(async () => {});
    expect(server.asked('/api/mobile/v1/actions/recordAgentView')).toHaveLength(0);
  });

  it('shows an edit made to the profile, not the card as it was half a minute ago', async () => {
    server.on('POST /api/mobile/v1/actions/saveProfileRecord', () => {
      card = card ? { ...card, headline_ar: 'مديرة مبيعات في الشيخ زايد' } : card;
      return { ok: true };
    });
    withEdit = true;
    try {
      renderRouter(app, { initialUrl: '/account/profile/preview' });
      expect(await screen.findByText('مديرة مبيعات ريسيل في التجمع')).toBeTruthy();

      fireEvent.press(screen.getByRole('button', { name: 'edit the profile' }));
      expect(await screen.findByText('مديرة مبيعات في الشيخ زايد')).toBeTruthy();
    } finally {
      withEdit = false;
    }
  });
});

describe('within the card list', () => {
  it('reads a card to VoiceOver as one line, with the shortlist as an action on it', async () => {
    renderRouter(app, { initialUrl: '/agents' });
    const cardLink = await screen.findByLabelText(new RegExp('^منى علي'));
    expect(cardLink.props.accessibilityActions).toEqual([{ name: 'shortlist', label: ar.agents.shortlistAdd }]);
    expect(within(cardLink).getByText('منى علي')).toBeTruthy();
  });
});
