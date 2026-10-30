import type { ReactNode } from 'react';
import { Linking, Text as RNText } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { createTranslator, useTranslations } from 'use-intl';
import type { AgentProfileRow } from '@/lib/supabase/database.types';
import { Num } from '~/components/ui/num';
import { ChoiceRow, SettingsGroup, SettingsRow, SwitchRow } from '~/components/ui/settings-list';
import {
  appPreferences,
  resetAppPreferencesForTests,
  setAppPreference,
  toNumerals,
} from '~/features/preferences/app-preferences';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { LRI, markupTags, PDI } from '~/i18n/rich';
import { resetAnalyticsForTests, useAnalyticsOptOut } from '~/lib/analytics';
import { haptic } from '~/lib/haptics';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AppearanceScreen from '../src/app/(tabs)/(account)/account/appearance';
import * as AvailabilityScreen from '../src/app/(tabs)/(account)/account/availability';
import * as PrivacyScreen from '../src/app/(tabs)/(account)/account/privacy';
import * as SupportScreen from '../src/app/(tabs)/(account)/account/support';
import { authSession, authUser, mobileConfig, profile, USER_ID } from './auth-fixtures';
import { board, newCairo } from './fixtures';
import { fakeServer } from './server';

/*
  Account → Appearance, Privacy, Job-seeking status and Support (the v1.1
  Account boards): what each choice is kept as, what each save sends the
  website, and the rows they are drawn with — right to left, and at the
  largest text size.
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

const mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const ar = catalogues.ar;
const translate = createTranslator({ locale: 'ar', messages: catalogues.ar });
const server = fakeServer();
const PASSWORD = 'correct-horse';
const user = authUser();
const AGENT_ID = '0a000000-0000-4000-8000-000000000001';

const baseAgent: AgentProfileRow = {
  id: AGENT_ID,
  user_id: USER_ID,
  slug: 'sara-a1b2',
  headline_ar: 'مستشارة مبيعات',
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

let agent: AgentProfileRow | null;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  agent = { ...baseAgent };
  resetAppPreferencesForTests();
  resetAnalyticsForTests();
  mockWindow.fontScale = 1;

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () => authSession(user));
  server.on('POST /auth/v1/logout', {});
  server.on('GET /auth/v1/user', () => user);
  server.on('/rest/v1/profiles', [profile]);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/developers', [{ id: 3, name_ar: 'بالم هيلز', name_en: 'Palm Hills', slug: 'palm-hills' }]);
  server.on('GET /rest/v1/agent_profiles', () => (agent ? [agent] : []));
  server.on('GET /rest/v1/agent_developers', [{ developer_id: 3 }]);
  server.on('POST /rest/v1/rpc/profile_completeness', () => 70);
  server.on('POST /rest/v1/rpc/candidate_summary', { profile_views_30d: 0 });
  server.on('GET /api/mobile/v1/jobs', () => board(undefined, { total: 23 }));
  server.on('GET /api/health', { status: 'ok' });
  server.on('GET /api/account/export', { exported_at: '2026-09-28T10:00:00Z', account: { id: USER_ID } });
  server.on('POST /api/mobile/v1/actions/saveAgentProfile', (_url, init) => {
    const input = JSON.parse(String(init?.body ?? '{}')).input ?? {};
    if (agent) agent = { ...agent, visibility: input.visibility, availability: input.availability, tracks: input.tracks, district_ids: input.districtIds };
    return { ok: true };
  });

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

const app = {
  _layout: Root,
  '(tabs)/(account)/_layout': () => <Stack />,
  '(tabs)/(account)/account/appearance': AppearanceScreen,
  '(tabs)/(account)/account/privacy': PrivacyScreen,
  '(tabs)/(account)/account/availability': AvailabilityScreen,
  '(tabs)/(account)/account/support': SupportScreen,
};

const sent = (index = 0) =>
  (server.asked('/api/mobile/v1/actions/saveAgentProfile')[index]?.body as { input?: Record<string, unknown> } | undefined)?.input;

describe('the digits numbers are written in', () => {
  it('are Western by default, and Arabic-Indic with their own separators when chosen, in Arabic only', () => {
    expect(toNumerals('12,500.5', 'latn', 'ar')).toBe('12,500.5');
    expect(toNumerals('12,500.5', 'arab', 'ar')).toBe('١٢٬٥٠٠٫٥');
    expect(toNumerals('12,500', 'arab', 'en')).toBe('12,500');
  });

  it('reach Num and every number in a sentence, and are kept on the phone', async () => {
    function Sample() {
      const t = useTranslations();
      return (
        <>
          <Num value={12000} testID="num" />
          <RNText testID="sentence">{t.markup('app.seeking.matches', { count: 23, ...markupTags })}</RNText>
        </>
      );
    }
    const view = render(
      <ThemeProvider>
        <I18nProvider>
          <Sample />
        </I18nProvider>
      </ThemeProvider>,
    );
    expect(view.getByTestId('num').props.children).toBe(`${LRI}12,000${PDI}`);
    act(() => setAppPreference('numerals', 'arab'));
    expect(view.getByTestId('num').props.children).toBe(`${LRI}١٢٬٠٠٠${PDI}`);
    expect(String(view.getByTestId('sentence').props.children)).toContain(`${LRI}٢٣${PDI}`);
    expect(JSON.parse((await AsyncStorage.getItem('bc.app-preferences.v1')) ?? '{}')).toMatchObject({ numerals: 'arab' });
  });
});

describe('the phone tapping back', () => {
  it('stops when its switch is off', () => {
    const impact = jest.spyOn(Haptics, 'impactAsync').mockResolvedValue();
    const notify = jest.spyOn(Haptics, 'notificationAsync').mockResolvedValue();
    haptic.tap();
    expect(impact).toHaveBeenCalledTimes(1);
    setAppPreference('haptics', false);
    haptic.tap();
    haptic.success();
    expect(impact).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    impact.mockRestore();
    notify.mockRestore();
  });
});

describe('Appearance', () => {
  it('keeps reduced motion and haptics on the phone, and offers the theme as three radio buttons', async () => {
    await renderRouter(app, { initialUrl: '/account/appearance' });
    expect((await screen.findByLabelText(ar.app.appearance.theme)).props.accessibilityRole).toBe('radiogroup');
    fireEvent(screen.getByTestId('reduce-motion'), 'valueChange', true);
    fireEvent(screen.getByTestId('haptics'), 'valueChange', false);
    expect(appPreferences()).toMatchObject({ reduceMotion: true, haptics: false });
    fireEvent.press(screen.getByRole('radio', { name: ar.app.appearance.numeralsArab }));
    expect(appPreferences().numerals).toBe('arab');
  });
});

describe('Privacy', () => {
  it('lists which companies revealed the number, by company, newest first', async () => {
    server.on('POST /rest/v1/rpc/my_contact_reveals', [
      { revealed_at: '2026-10-29T10:00:00Z', company_name_ar: 'شركة النيل', company_name_en: null, company_slug: 'nile' },
      { revealed_at: '2026-10-20T10:00:00Z', company_name_ar: null, company_name_en: null, company_slug: null },
    ]);
    await renderRouter(app, { initialUrl: '/account/privacy' });
    expect(await screen.findByText(ar.app.privacy.revealLog)).toBeTruthy();
    expect(screen.getByText('شركة النيل')).toBeTruthy();
    expect(screen.getByText(ar.app.privacy.revealLogGone)).toBeTruthy();
  });

  it('saves who sees the card the moment it is picked, with everything else on the card as it was read', async () => {
    await renderRouter(app, { initialUrl: '/account/privacy' });
    fireEvent.press(await screen.findByRole('radio', { name: new RegExp(`^${ar.visibility.hidden}`) }));
    await waitFor(() => expect(sent()).toBeDefined());
    expect(sent()).toMatchObject({
      fullName: profile.full_name,
      headlineAr: 'مستشارة مبيعات',
      yearsExperience: 3,
      tracks: ['primary'],
      districtIds: [newCairo.id],
      developerIds: [3],
      languages: ['ar'],
      availability: 'open_to_offers',
      visibility: 'hidden',
      cvPath: null,
      removeCv: false,
    });
  });

  it("turns this phone's analytics off", async () => {
    function Probe() {
      return <RNText testID="opted-out">{String(useAnalyticsOptOut())}</RNText>;
    }
    const probe = render(<Probe />);
    await renderRouter(app, { initialUrl: '/account/privacy' });
    expect((await screen.findByTestId('analytics')).props.value).toBe(true);
    fireEvent(screen.getByTestId('analytics'), 'valueChange', false);
    await waitFor(() => expect(probe.getByTestId('opted-out').props.children).toBe('true'));
  });

  it('says there is no card to place yet, with the way to make one', async () => {
    agent = null;
    await renderRouter(app, { initialUrl: '/account/privacy' });
    expect(await screen.findByText(ar.app.privacy.noCard)).toBeTruthy();
  });
});

describe('Job-seeking status', () => {
  it('says how many listings match, and saves the status, tracks and areas together', async () => {
    await renderRouter(app, { initialUrl: '/account/availability' });
    expect(await screen.findByText(new RegExp(`${LRI}23${PDI}`))).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: new RegExp(`^${ar.availability.actively_searching}`) }));
    fireEvent.press(screen.getByRole('button', { name: ar.common.save }));
    await waitFor(() => expect(sent()).toMatchObject({ availability: 'actively_searching', tracks: ['primary'], developerIds: [3] }));
  });
});

describe('Support', () => {
  it("says the service is up as the website's health check does, and down on a 503", async () => {
    const first = await renderRouter(app, { initialUrl: '/account/support' });
    expect(await screen.findByText(ar.app.support.statusOk)).toBeTruthy();
    first.unmount();
    server.on('GET /api/health', { status: 503, body: { status: 'degraded' } });
    await renderRouter(app, { initialUrl: '/account/support' });
    expect(await screen.findByText(ar.app.support.statusDown)).toBeTruthy();
  });

  it('writes a problem report with the version and the phone filled in', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    await renderRouter(app, { initialUrl: '/account/support' });
    fireEvent.press(await screen.findByRole('button', { name: new RegExp(ar.app.support.report) }));
    const url = String(open.mock.calls[0]?.[0]);
    expect(url).toMatch(/^mailto:[^?]+\?subject=.+&body=/);
    expect(decodeURIComponent(url)).toContain(ar.app.support.reportSubject);
    expect(decodeURIComponent(url)).toMatch(/1\.0\.0/);
    open.mockRestore();
  });

  it('opens each answer under its question', async () => {
    await renderRouter(app, { initialUrl: '/account/support' });
    const question = await screen.findByRole('button', { name: ar.appPage.faq.q3 });
    expect(screen.queryByText(ar.appPage.faq.a3)).toBeNull();
    fireEvent.press(question);
    expect(screen.getByText(ar.appPage.faq.a3)).toBeTruthy();
    expect(question.props.accessibilityState).toMatchObject({ expanded: true });
  });
});

describe('the settings rows', () => {
  function Rows() {
    return (
      <SettingsGroup title={translate('app.account.groupApp')} footer={translate('app.appearance.numeralsHint')}>
        <SettingsRow label={translate('app.account.appearanceRow')} value={translate('theme.system')} onPress={() => {}} />
        <SwitchRow label={translate('app.appearance.haptics')} hint={translate('app.appearance.hapticsHint')} value onChange={() => {}} />
        <ChoiceRow label={translate('visibility.hidden')} hint={translate('visibility.hiddenHint')} selected onPress={() => {}} />
      </SettingsGroup>
    );
  }
  const draw = () =>
    render(
      <ThemeProvider>
        <I18nProvider>
          <Rows />
        </I18nProvider>
      </ThemeProvider>,
    ).toJSON();

  it('draws right to left', () => {
    expect(draw()).toMatchSnapshot();
  });

  it('draws at the largest text size, the value under the name', () => {
    mockWindow.fontScale = 3.571;
    expect(draw()).toMatchSnapshot();
  });
});
