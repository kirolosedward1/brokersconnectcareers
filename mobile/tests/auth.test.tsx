import { AccessibilityInfo, Alert, BackHandler, Linking, Platform, Text } from 'react-native';
import { router, Stack, Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { confirmsDeletion, DELETE_WORD_ANY_KEYBOARD } from '@/lib/delete-confirmation';
import { PendingPath } from '~/components/navigation/pending-path';
import { SessionGate } from '~/components/navigation/session-gate';
import { confirmationPath } from '~/features/auth/intent';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { encryptedSessionStorage } from '~/lib/session-storage';
import { SessionProvider } from '~/lib/session';
import { SESSION_KEY, supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AuthLayout from '../src/app/(auth)/_layout';
import * as SignInScreen from '../src/app/(auth)/sign-in/index';
import * as ForgotScreen from '../src/app/(auth)/sign-in/forgot';
import * as NewPasswordScreen from '../src/app/(auth)/sign-in/new-password';
import * as SignUpScreen from '../src/app/(auth)/sign-up';
import * as TabStack from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/_layout';
import * as CompanyScreen from '../src/app/(tabs)/(home,jobs,companies,applications,saved,account,listings,applicants,consultants)/companies/[slug]';
import * as AccountScreen from '../src/app/(tabs)/(account)/account/index';
import * as DeleteAccountScreen from '../src/app/(tabs)/(account)/account/delete';
import * as LicensesScreen from '../src/app/(tabs)/(account)/account/licenses';
import * as ConfirmScreen from '../src/app/auth/confirm';
import * as CallbackScreen from '../src/app/auth/callback';
import { redirectSystemPath } from '../src/app/+native-intent';
import * as MfaScreen from '../src/app/mfa';
import * as OnboardingScreen from '../src/app/onboarding';
import * as WelcomeScreen from '../src/app/welcome';
import {
  authSession,
  authUser,
  mobileConfig,
  ownedCompany,
  profile,
  SITE,
  totpFactor,
  USER_ID,
  type AuthUser,
} from './auth-fixtures';
import { cairo, company, companyPage, newCairo } from './fixtures';
import { watchFocus } from './focus';
import { placeViewsAt } from './measure';
import { fakeServer } from './server';

/*
  Signing in, as a person does it, against stand-ins for Supabase Auth and the
  website: the real screens, the real supabase-js client, the real session
  provider and gate. What GoTrue is sent, what the website's actions are
  asked, and where each flow leaves the person are what is checked.
*/

// The session in memory: the encrypted store is the Keychain's business.
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

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
  openAuthSessionAsync: jest.fn(),
}));

// Deterministic randomness and a readable "hash", so the nonce can be followed.
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  getRandomBytes: (count: number) => new Uint8Array(count).fill(171),
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `sha256:${value}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const ar = catalogues.ar;
const server = fakeServer();

let user: AuthUser = authUser();
let profileRow: typeof profile | null = profile;
let companyId: string | null = null;
const PASSWORD = 'correct-horse';

const warnings: string[] = [];

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.map(String).join(' '));
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

beforeEach(async () => {
  user = authUser();
  profileRow = profile;
  companyId = null;
  warnings.length = 0;
  jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(false);

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('/rest/v1/districts', [newCairo]);
  server.on('/rest/v1/governorates', [cairo]);
  server.on('/rest/v1/profiles', () => (profileRow ? [profileRow] : []));
  server.on('/rest/v1/rpc/my_company_id', () => companyId);
  server.on('/rest/v1/companies', () => (companyId ? [ownedCompany] : []));

  server.on('POST /auth/v1/token', (url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password' && body.password !== PASSWORD) {
      return { status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
    }
    return authSession(user);
  });
  server.on('POST /auth/v1/signup', () => authUser({ email_confirmed_at: null }));
  server.on('POST /auth/v1/verify', () => authSession(user));
  server.on('GET /auth/v1/user', () => user);
  server.on('PUT /auth/v1/user', (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    user = { ...user, user_metadata: { ...user.user_metadata, ...(body.data ?? {}) } };
    return user;
  });
  server.on('POST /auth/v1/logout', {});
  server.on(`POST /auth/v1/factors/${totpFactor.id}/challenge`, {
    id: 'challenge-1',
    type: 'totp',
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
  server.on(`POST /auth/v1/factors/${totpFactor.id}/verify`, (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.code !== '123456') {
      return { status: 422, body: { code: 422, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' } };
    }
    return authSession(user, 'aal2');
  });

  server.on('POST /api/mobile/v1/actions/reportAuthOutcome', { pause: 0, challenge: false });
  server.on('POST /api/mobile/v1/actions/resendConfirmation', { ok: true });
  server.on('POST /api/mobile/v1/actions/requestPasswordReset', { ok: true });
  server.on('POST /api/mobile/v1/actions/announcePasswordChange', { ok: true });
  server.on('POST /api/mobile/v1/actions/completeOnboarding', () => {
    profileRow = profile;
    return { ok: true, data: { role: 'candidate' } };
  });
  server.on('POST /api/mobile/v1/actions/deleteMyAccount', { ok: true });

  // Nobody signed in, whatever the last test left.
  await supabase.auth.signOut({ scope: 'local' });
  server.requests.length = 0;
});

afterEach(() => {
  // No message may fail to format.
  expect(warnings.filter((warning) => warning.includes('[i18n]'))).toEqual([]);
});

function Root() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <SessionGate />
            <PendingPath />
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const app = {
  _layout: { default: Root, unstable_settings: { anchor: '(tabs)' } },
  // Home first, as the app's own tab bar has it.
  '(tabs)/_layout': () => (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(home)" />
      <Tabs.Screen name="(account)" />
    </Tabs>
  ),
  '(tabs)/(home,account)/_layout': TabStack,
  '(tabs)/(home,account)/companies/[slug]': CompanyScreen,
  '(tabs)/(home)/index': () => <Text>home screen</Text>,
  '(tabs)/(account)/account/index': AccountScreen,
  '(tabs)/(account)/account/delete': DeleteAccountScreen,
  '(tabs)/(account)/account/licenses': LicensesScreen,
  '(auth)/_layout': AuthLayout,
  '(auth)/sign-in/index': SignInScreen,
  '(auth)/sign-in/forgot': ForgotScreen,
  '(auth)/sign-in/new-password': NewPasswordScreen,
  '(auth)/sign-up': SignUpScreen,
  onboarding: OnboardingScreen,
  mfa: MfaScreen,
  'auth/confirm': ConfirmScreen,
  'auth/callback': CallbackScreen,
  welcome: WelcomeScreen,
};

/** The delete screen's field, named as the catalogue words it: the word to type, in its quotes. */
const deleteLabel = ar.account.deleteConfirmLabel.replace('<b>{word}</b>', ar.account.deleteConfirmWord);

/** Press a button once it can be pressed — the forms wait for the config first. */
async function press(name: string | RegExp) {
  fireEvent.press(await screen.findByRole('button', { name, disabled: false }));
}

async function fillSignIn(email: string, password: string) {
  fireEvent.changeText(await screen.findByLabelText(ar.auth.email), email);
  fireEvent.changeText(screen.getByLabelText(ar.auth.password), password);
}

const bodyOf = (path: string, index = 0) => server.asked(path)[index]?.body as Record<string, unknown> | undefined;

/** Onboarding's way on, from one step to the next. */
const onward = () => press(ar.jobForm.next);
const HIDDEN = `${ar.visibility.hidden}. ${ar.visibility.hiddenHint}`;
const EMPLOYER = `${ar.onboarding.roleEmployer}. ${ar.onboarding.roleEmployerHint}`;

/**
 * Onboarding answered as a consultant, step by step: past the role when it is
 * asked, the name and number, who sees the card, and the agreement.
 */
async function answerOnboarding(name = 'سارة عادل') {
  expect(await screen.findByText(ar.onboarding.title)).toBeTruthy();
  if (screen.queryByLabelText(ar.onboarding.roleQuestion)) await onward();
  fireEvent.changeText(await screen.findByLabelText(ar.onboarding.fullName), name);
  fireEvent.changeText(screen.getByLabelText(ar.onboarding.whatsapp), '01001234567');
  await onward();
  fireEvent.press(await screen.findByRole('radio', { name: HIDDEN }));
  await onward();
  fireEvent.press(await screen.findByRole('checkbox'));
  await press(ar.onboarding.submit);
}

/** Signed in before the app opens, the way a returning person is. */
async function signedIn() {
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  server.requests.length = 0;
}

describe('the Account tab', () => {
  it('is the door when signed out', async () => {
    renderRouter(app, { initialUrl: '/account' });
    expect(await screen.findByText(ar.app.account.signedOutTitle)).toBeTruthy();
    await press(ar.nav.signIn);
    expect(await screen.findByText(ar.auth.signInTitle)).toBeTruthy();
  });

  it('keeps the policies, the licences and who runs the app one tap away, signed in or not', async () => {
    renderRouter(app, { initialUrl: '/account' });
    expect(await screen.findByText(ar.app.account.signedOutTitle)).toBeTruthy();
    expect(screen.getByText(ar.footer.operatedBy.replace('{name}', 'Top Suite Digital Marketing'))).toBeTruthy();

    await press(ar.footer.privacy);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(`${SITE}/privacy`);
    await press(ar.footer.terms);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(`${SITE}/terms`);
    await press(ar.licenses.title);
    expect(await screen.findByText(ar.app.licenses.intro)).toBeTruthy();
  });

  it('writes to the address without showing it, and tells it when no mail app can', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    // Alert.alert is the suite's own stand-in (above).
    jest.mocked(Alert.alert).mockClear();
    renderRouter(app, { initialUrl: '/account' });
    await press(ar.app.account.contact);
    expect(open).toHaveBeenCalledWith('mailto:help@brokersconnect.net');
    expect(screen.queryByText('help@brokersconnect.net')).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();

    open.mockRejectedValue(new Error('no mail app'));
    await press(ar.app.account.contact);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(ar.app.account.contact, 'help@brokersconnect.net'));
    open.mockRestore();
  });

  it('says who is signed in, and signs out of this phone only', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/account' });
    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    expect(screen.getByText(`داخل بحساب ${user.email}`)).toBeTruthy();

    await press(ar.nav.signOut);
    expect(await screen.findByText(ar.app.account.signedOutTitle)).toBeTruthy();
    expect(server.asked('/auth/v1/logout')[0]?.url.searchParams.get('scope')).toBe('local');
  });
});

describe('signing in with a password', () => {
  it("says the website's words when GoTrue refuses, and tells the server", async () => {
    renderRouter(app, { initialUrl: '/sign-in' });
    await fillSignIn(' sara@example.com ', 'wrong-password');
    await press(ar.auth.signIn);

    expect(await screen.findByText(ar.auth.errBadCredentials)).toBeTruthy();
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/reportAuthOutcome')).toHaveLength(1));
    expect(bodyOf('/api/mobile/v1/actions/reportAuthOutcome')).toEqual({
      input: { kind: 'sign_in_failed', email: 'sara@example.com' },
    });
  });

  it('asks for eight characters before sending anything', async () => {
    renderRouter(app, { initialUrl: '/sign-in' });
    await fillSignIn('sara@example.com', 'short');
    await press(ar.auth.signIn);
    expect(await screen.findByText(ar.validation.passwordShort)).toBeTruthy();
    expect(server.asked('/auth/v1/token')).toHaveLength(0);
  });

  it('pauses when the server asks it to', async () => {
    server.on('POST /api/mobile/v1/actions/reportAuthOutcome', { pause: 6, challenge: false });
    renderRouter(app, { initialUrl: '/sign-in' });
    await fillSignIn('sara@example.com', 'wrong-password');
    await press(ar.auth.signIn);
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/reportAuthOutcome')).toHaveLength(1));
    await screen.findByText(ar.auth.errBadCredentials);

    await press(ar.auth.signIn);
    expect(await screen.findByText(/استنى \d+ ثواني وحاول تاني\.|استنى \d+ ثانية وحاول تاني\./)).toBeTruthy();
    expect(server.asked('/auth/v1/token')).toHaveLength(1);
  });

  it('offers the confirmation email again when that is what stands in the way', async () => {
    server.on('POST /auth/v1/token', {
      status: 400,
      body: { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' },
    });
    renderRouter(app, { initialUrl: '/sign-in?role=employer' });
    await fillSignIn('sara@example.com', PASSWORD);
    await press(ar.auth.signIn);
    expect(await screen.findByText(ar.auth.errEmailUnconfirmed)).toBeTruthy();

    await press(ar.auth.resendConfirmation);
    expect(await screen.findByText(ar.auth.resendSent)).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/resendConfirmation')).toEqual({
      input: { email: 'sara@example.com', redirectTo: confirmationPath({ role: 'employer', next: null }) },
    });
  });

  it('closes the sheet onto where the person was', async () => {
    renderRouter(app, { initialUrl: '/account' });
    await press(ar.nav.signIn);
    await fillSignIn('sara@example.com', PASSWORD);
    await press(ar.auth.signIn);

    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    expect(screen.queryByText(ar.auth.signInTitle)).toBeNull();
    expect(bodyOf('/auth/v1/token')).toMatchObject({ email: 'sara@example.com', password: PASSWORD });
  });

  it('closes the welcome along with the sheet when the sign-in began there', async () => {
    renderRouter(app, { initialUrl: '/welcome' });
    await press(ar.nav.signIn);
    await fillSignIn('sara@example.com', PASSWORD);
    await press(ar.auth.signIn);

    expect(await screen.findByText('home screen')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('welcome')).toBeNull());
    expect(screen.queryByText(ar.auth.signInTitle)).toBeNull();
  });

  it('goes on to where the person was headed', async () => {
    const result = renderRouter(app, { initialUrl: '/sign-in?next=%2Faccount%2Fdelete' });
    await fillSignIn('sara@example.com', PASSWORD);
    await press(ar.auth.signIn);
    await waitFor(() => expect(result.getPathname()).toBe('/account/delete'));
  });

  it('refuses a destination that is not a path of ours', async () => {
    const result = renderRouter(app, { initialUrl: '/sign-in?next=https%3A%2F%2Fevil.example' });
    await fillSignIn('sara@example.com', PASSWORD);
    await press(ar.auth.signIn);
    await waitFor(() => expect(result.getPathname()).toBe('/'));
  });
});

describe('the captcha', () => {
  const { __webview: webview } = jest.requireMock('react-native-webview') as {
    __webview: { latest: { onMessage: (event: unknown) => void } | null; loads: number };
  };
  const post = (message: object) =>
    act(() => webview.latest?.onMessage({ nativeEvent: { data: JSON.stringify(message) } }));

  it('holds the form until the page hands over a token, sends it, and fetches another', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ turnstileSiteKey: 'site-key' }));
    renderRouter(app, { initialUrl: '/sign-in' });
    await fillSignIn('sara@example.com', 'wrong-password');

    await screen.findByText(ar.app.auth.captchaChecking);
    expect(screen.getByRole('button', { name: ar.auth.signIn }).props.accessibilityState.disabled).toBe(true);

    const loads = webview.loads;
    post({ type: 'token', token: 'turnstile-token' });
    await press(ar.auth.signIn);
    await screen.findByText(ar.auth.errBadCredentials);

    expect(bodyOf('/auth/v1/token')).toMatchObject({ gotrue_meta_security: { captcha_token: 'turnstile-token' } });
    // Spent: the page is loaded again for the next attempt.
    await waitFor(() => expect(webview.loads).toBe(loads + 1));
  });

  it('shows the widget when Cloudflare wants a person, and offers a retry when it cannot load', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ turnstileSiteKey: 'site-key' }));
    renderRouter(app, { initialUrl: '/sign-in' });
    await screen.findByText(ar.app.auth.captchaChecking);

    post({ type: 'interactive' });
    expect(await screen.findByText(ar.app.auth.captchaPrompt)).toBeTruthy();

    post({ type: 'unavailable' });
    expect(await screen.findByText(ar.app.auth.captchaFailed)).toBeTruthy();
    const loads = webview.loads;
    await press(ar.app.auth.captchaRetry);
    await waitFor(() => expect(webview.loads).toBe(loads + 1));
  });
});

describe('creating an account', () => {
  it('sends the confirmation back through onboarding, with the door and the destination', async () => {
    renderRouter(app, { initialUrl: '/sign-up?role=employer&next=%2Fjobs%2Fsales-a1b2' });
    expect(await screen.findByText(ar.auth.signUpTitleEmployer)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.auth.email), 'new@example.com');
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), PASSWORD);
    await press(ar.auth.signUp);

    expect(await screen.findByText(ar.auth.checkEmailTitle)).toBeTruthy();
    const request = server.asked('/auth/v1/signup')[0];
    expect(request.url.searchParams.get('redirect_to')).toBe(
      `${SITE}${confirmationPath({ role: 'employer', next: '/jobs/sales-a1b2' })}`,
    );
    expect(request.body).toMatchObject({ email: 'new@example.com', data: { role: 'employer' } });

    await press(ar.auth.resendConfirmation);
    expect(await screen.findByText(ar.auth.resendSent)).toBeTruthy();
  });

  it('says where the policies are where the address is asked for, and opens them', async () => {
    renderRouter(app, { initialUrl: '/sign-up' });
    fireEvent.press(await screen.findByText(ar.footer.privacy));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(`${SITE}/privacy`);
    fireEvent.press(screen.getByText(ar.footer.terms));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(`${SITE}/terms`);
    expect(server.asked('/auth/v1/signup')).toHaveLength(0);
  });

  it('moves from field to field with the return key, and signs up from the last', async () => {
    const focus = watchFocus();
    try {
      renderRouter(app, { initialUrl: '/sign-up' });
      const email = await screen.findByLabelText(ar.auth.email);
      expect(email.props.returnKeyType).toBe('next');
      fireEvent.changeText(email, 'new@example.com');
      fireEvent(email, 'submitEditing');
      expect(focus.focused).toEqual([ar.auth.password]);
      fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
      fireEvent(screen.getByLabelText(ar.auth.password), 'submitEditing');
      expect(focus.focused).toEqual([ar.auth.password, ar.auth.passwordConfirm]);
      fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), PASSWORD);
      await waitFor(() => expect(screen.getByRole('button', { name: ar.auth.signUp, disabled: false })).toBeTruthy());
      fireEvent(screen.getByLabelText(ar.auth.passwordConfirm), 'submitEditing');
      expect(await screen.findByText(ar.auth.checkEmailTitle)).toBeTruthy();
      expect(server.asked('/auth/v1/signup')).toHaveLength(1);
    } finally {
      focus.undo();
    }
  });

  it('catches a mistyped password before sending it', async () => {
    renderRouter(app, { initialUrl: '/sign-up' });
    fireEvent.changeText(await screen.findByLabelText(ar.auth.email), 'new@example.com');
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'correct-horsf');
    await press(ar.auth.signUp);
    expect(await screen.findByText(ar.validation.passwordMismatch)).toBeTruthy();
    expect(server.asked('/auth/v1/signup')).toHaveLength(0);
  });
});

describe('onboarding', () => {
  it('follows a sign-in on an account with no profile, and makes one', async () => {
    profileRow = null;
    renderRouter(app, { initialUrl: '/account' });
    await press(ar.nav.signIn);
    await fillSignIn('sara@example.com', PASSWORD);
    await press(ar.auth.signIn);

    expect(await screen.findByText(ar.onboarding.title)).toBeTruthy();
    // A step at a time, and where it is in them, to VoiceOver too.
    const stepOf = (current: number, total: number) =>
      ar.app.jobs.wizardStep.replace('<v>{current}</v>', `\u2066${current}\u2069`).replace('<v>{total}</v>', `\u2066${total}\u2069`);
    expect(screen.getByRole('progressbar', { name: stepOf(1, 4) })).toBeTruthy();
    // First the kind of account, the consultant's offered.
    expect(screen.getByLabelText(ar.onboarding.roleQuestion).props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: `${ar.onboarding.roleCandidate}. ${ar.onboarding.roleCandidateHint}`, checked: true })).toBeTruthy();
    // No way back from the first step; sign out and delete are there instead.
    expect(screen.queryByRole('button', { name: ar.common.back })).toBeNull();
    await onward();

    // The name offered is the address's, as on the website when no provider gave one.
    expect(await screen.findByDisplayValue('sara')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: stepOf(2, 4) })).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.fullName), 'سارة عادل');
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.whatsapp), '01001234567');
    await onward();

    // Who sees the directory card is asked, one choice among three, with none made for them.
    const visibility = await screen.findByLabelText(ar.onboarding.visibilityQuestion);
    expect(visibility.props.accessibilityRole).toBe('radiogroup');
    expect(within(visibility).getAllByRole('radio')).toHaveLength(3);
    expect(within(visibility).queryAllByRole('radio', { checked: true })).toHaveLength(0);
    fireEvent.press(screen.getByRole('radio', { name: HIDDEN }));
    // Back keeps what was typed.
    await press(ar.common.back);
    expect(await screen.findByDisplayValue('سارة عادل')).toBeTruthy();
    await onward();
    expect(await screen.findByRole('radio', { name: HIDDEN, checked: true })).toBeTruthy();
    await onward();

    // The language is a choice of its own, made already: the phone's.
    expect((await screen.findByLabelText(ar.onboarding.locale)).props.accessibilityRole).toBe('radiogroup');
    fireEvent.press(screen.getByRole('checkbox'));
    await press(ar.onboarding.submit);

    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/completeOnboarding')).toEqual({
      input: {
        role: 'candidate',
        fullName: 'سارة عادل',
        whatsapp: '01001234567',
        locale: 'ar',
        agreed: true,
        visibility: 'hidden',
      },
    });
  });

  it('moves from the name to the number with the return key', async () => {
    profileRow = null;
    await signedIn();
    const focus = watchFocus();
    try {
      renderRouter(app, { initialUrl: '/onboarding' });
      await onward();
      fireEvent(await screen.findByLabelText(ar.onboarding.fullName), 'submitEditing');
      expect(focus.focused).toEqual([ar.onboarding.whatsapp]);
    } finally {
      focus.undo();
    }
  });

  it('offers the Terms and the Privacy policy inside the agreement to VoiceOver, which cannot reach its links', async () => {
    profileRow = null;
    await signedIn();
    renderRouter(app, { initialUrl: '/onboarding' });
    await onward();
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.whatsapp), '01001234567');
    await onward();
    fireEvent.press(await screen.findByRole('radio', { name: HIDDEN }));
    await onward();
    const agreement = await screen.findByRole('checkbox');
    expect(agreement.props.accessibilityActions.map((action: { label: string }) => action.label)).toEqual([ar.footer.terms, ar.footer.privacy]);

    fireEvent(agreement, 'accessibilityAction', { nativeEvent: { actionName: 'terms' } });
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(`${SITE}/terms`);
    fireEvent(agreement, 'accessibilityAction', { nativeEvent: { actionName: 'privacy' } });
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(`${SITE}/privacy`);
    // Neither ticks the box.
    expect(agreement.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('asks for the directory choice, then the agreement and the age, before anything is created', async () => {
    profileRow = null;
    await signedIn();
    renderRouter(app, { initialUrl: '/onboarding' });
    await onward();
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.whatsapp), '01001234567');
    await onward();
    // Who sees the card: answered before going on.
    await screen.findByLabelText(ar.onboarding.visibilityQuestion);
    await onward();
    expect(await screen.findByText(ar.onboarding.visibilityRequired)).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: HIDDEN }));
    await onward();
    await press(ar.onboarding.submit);
    expect(await screen.findByText(ar.onboarding.consentRequired)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/completeOnboarding')).toHaveLength(0);
  });

  it('checks the number before going on, and brings the error into view and says it', async () => {
    profileRow = null;
    await signedIn();
    const announce = AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock;
    announce.mockClear();
    const layout = placeViewsAt(300);
    try {
      renderRouter(app, { initialUrl: '/onboarding' });
      await onward();
      fireEvent.changeText(await screen.findByLabelText(ar.onboarding.whatsapp), '12');
      await onward();

      expect(await screen.findByText(ar.validation.invalidPhone)).toBeTruthy();
      expect(server.asked('/api/mobile/v1/actions/completeOnboarding')).toHaveLength(0);
      expect(announce).toHaveBeenCalledWith(ar.validation.invalidPhone, { queue: true });
      await waitFor(() => expect(layout.scrollTo).toHaveBeenCalledWith({ y: 300 - 16, animated: true }));
    } finally {
      layout.undo();
    }
  });

  it("asks a company for what a reviewer needs, and says which field the server refused", async () => {
    profileRow = null;
    server.on('POST /api/mobile/v1/actions/completeOnboarding', {
      ok: false,
      error: 'invalid',
      fieldErrors: { whatsapp: 'invalidPhone' },
    });
    await signedIn();
    renderRouter(app, { initialUrl: '/onboarding' });
    fireEvent.press(await screen.findByRole('radio', { name: EMPLOYER }));
    // The two kinds of account are one choice, named by the question they answer.
    expect(screen.getByLabelText(ar.onboarding.roleQuestion).props.accessibilityRole).toBe('radiogroup');
    await onward();
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.companyName), 'نايل بروكرز');
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.whatsapp), '01001234567');
    await onward();
    // A company is not asked about a consultant's card: the agreement is next, and last.
    expect(screen.queryByLabelText(ar.onboarding.visibilityQuestion)).toBeNull();
    fireEvent.press(await screen.findByRole('checkbox'));
    await press(ar.onboarding.submit);

    // Refused: back on the step that asks for the number, with the reason under it.
    expect(await screen.findByText(ar.validation.invalidPhone)).toBeTruthy();
    expect(screen.getByLabelText(ar.onboarding.whatsapp)).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/completeOnboarding')).toEqual({
      input: {
        role: 'employer',
        fullName: 'sara',
        whatsapp: '01001234567',
        locale: 'ar',
        agreed: true,
        company: { nameAr: 'نايل بروكرز', website: null, headcountBand: null, districtId: null },
      },
    });
  });

  it("takes a company's website as the company page does, and says when it is not one", async () => {
    profileRow = null;
    await signedIn();
    renderRouter(app, { initialUrl: '/onboarding' });
    fireEvent.press(await screen.findByRole('radio', { name: EMPLOYER }));
    await onward();
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.companyName), 'نايل بروكرز');
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.whatsapp), '01001234567');

    // Not an address: said before going on.
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.companyWebsite), 'نايل بروكرز دوت كوم');
    await onward();
    expect(await screen.findByText(ar.validation.invalidUrl)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();

    // A bare domain is the https address.
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.companyWebsite), 'nilebrokers.com');
    await onward();
    fireEvent.press(await screen.findByRole('checkbox'));
    await press(ar.onboarding.submit);
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/completeOnboarding')).toHaveLength(1));
    expect((bodyOf('/api/mobile/v1/actions/completeOnboarding') as { input: { company: { website: string } } }).input.company.website).toBe(
      'https://nilebrokers.com',
    );
  });

  it('opens by itself when a returning session has no profile yet', async () => {
    profileRow = null;
    await signedIn();
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.onboarding.title)).toBeTruthy();
  });

  /** The buttons of the last question Alert.alert asked. */
  const alertButtons = () =>
    (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[];

  it('lets an account that changed its mind go, without agreeing to anything first', async () => {
    profileRow = null;
    jest.mocked(Alert.alert).mockClear();
    await signedIn();
    renderRouter(app, { initialUrl: '/onboarding' });
    await press(ar.onboarding.leaveDelete);

    // Asked first; nothing goes until the person says so.
    expect(Alert.alert).toHaveBeenCalledWith(ar.onboarding.leaveDelete, ar.onboarding.leaveConfirm, expect.any(Array));
    expect(server.asked('/api/mobile/v1/actions/deleteMyAccount')).toHaveLength(0);
    const yes = alertButtons().find((button) => button.style === 'destructive');
    expect(yes?.text).toBe(ar.onboarding.leaveConfirmCta);
    await act(async () => yes?.onPress?.());

    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/deleteMyAccount')).toEqual({ input: {} }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(ar.app.account.deleted));
    expect(server.asked('/api/mobile/v1/actions/completeOnboarding')).toHaveLength(0);
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
    expect(await screen.findByText('home screen')).toBeTruthy();
  });

  it('stays, and says so, when the account could not be deleted', async () => {
    profileRow = null;
    server.on('POST /api/mobile/v1/actions/deleteMyAccount', { ok: false, error: 'unavailable' });
    jest.mocked(Alert.alert).mockClear();
    await signedIn();
    renderRouter(app, { initialUrl: '/onboarding' });
    await press(ar.onboarding.leaveDelete);
    await act(async () => alertButtons().find((button) => button.style === 'destructive')?.onPress?.());

    expect(await screen.findByText(ar.onboarding.leaveFailed)).toBeTruthy();
    expect(screen.getByText(ar.onboarding.title)).toBeTruthy();
    const { data } = await supabase.auth.getSession();
    expect(data.session).not.toBeNull();
  });
});

describe('the second factor', () => {
  it('is asked for after the password, and a wrong code is said to be wrong', async () => {
    user = authUser({ factors: [totpFactor] });
    renderRouter(app, { initialUrl: '/account' });
    await press(ar.nav.signIn);
    await fillSignIn('sara@example.com', PASSWORD);
    await press(ar.auth.signIn);

    expect(await screen.findByText(ar.account.mfaTitle)).toBeTruthy();
    // Short of six digits, the button says so without asking anybody.
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '12345');
    await press(ar.account.mfaVerify);
    expect(await screen.findByText(ar.account.mfaCodeInvalid)).toBeTruthy();
    expect(server.asked(`/auth/v1/factors/${totpFactor.id}/verify`)).toHaveLength(0);

    // Six are the answer, sent as the sixth is typed.
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '000000');
    await waitFor(() => expect(server.asked(`/auth/v1/factors/${totpFactor.id}/verify`)).toHaveLength(1));
    expect(await screen.findByText(ar.account.mfaCodeInvalid)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '123456');
    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    expect(server.asked(`/auth/v1/factors/${totpFactor.id}/verify`).at(-1)?.body).toMatchObject({
      code: '123456',
      challenge_id: 'challenge-1',
    });
  });

  it('answers by itself once six digits are in: the number pad has no return key, and AutoFill presses nothing', async () => {
    user = authUser({ factors: [totpFactor] });
    await signedIn();
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.account.mfaTitle)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '12345');
    expect(server.asked(`/auth/v1/factors/${totpFactor.id}/verify`)).toHaveLength(0);
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '123456');
    expect(await screen.findByText('home screen')).toBeTruthy();
    expect(server.asked(`/auth/v1/factors/${totpFactor.id}/verify`)).toHaveLength(1);
  });

  it('takes the code typed with Arabic-Indic digits, as an Arabic keyboard types it', async () => {
    user = authUser({ factors: [totpFactor] });
    await signedIn();
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.account.mfaTitle)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '١٢٣٤٥٦');
    await waitFor(() =>
      expect(server.asked(`/auth/v1/factors/${totpFactor.id}/verify`).at(-1)?.body).toMatchObject({ code: '123456' }),
    );
    expect(screen.queryByText(ar.account.mfaCodeInvalid)).toBeNull();
  });

  it('lets the person in when the authenticator was removed elsewhere, instead of asking over and over', async () => {
    user = authUser({ factors: [totpFactor] });
    await signedIn();
    // Removed on the website since: the auth server's account has none, and a refreshed session says so.
    user = authUser();
    const pushes: unknown[] = [];
    const push = router.push.bind(router);
    jest.spyOn(router, 'push').mockImplementation((...args: Parameters<typeof router.push>) => {
      pushes.push(args[0]);
      return push(...args);
    });
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.account.mfaTitle)).toBeTruthy();
    // A while later, so the refreshed session is a new one (the clock stands still under renderRouter).
    act(() => jest.setSystemTime(Date.now() + 60_000));
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '123456');

    expect(await screen.findByText('home screen')).toBeTruthy();
    // Asked once, at launch; not again once the answer was that there is nothing to ask.
    expect(pushes.filter((path) => path === '/mfa')).toHaveLength(1);
    expect(server.asked(`/auth/v1/factors/${totpFactor.id}/challenge`)).toHaveLength(0);
  });

  it('keeps what was typed on Android’s Back, which does nothing here', async () => {
    // Android's BackHandler: the newest listener first, until one takes the press.
    const listeners: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const add = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener);
      return { remove: () => void listeners.splice(listeners.indexOf(listener), 1) };
    });
    user = authUser({ factors: [totpFactor] });
    await signedIn();
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.account.mfaTitle)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '123');

    act(() => void [...listeners].reverse().some((listener) => listener({} as never)));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    // Not closed and opened again by the session gate: the same screen, with the same digits.
    expect(screen.getByLabelText(ar.account.mfaCode).props.value).toBe('123');
    add.mockRestore();
  });

  it('can be walked away from only by signing out', async () => {
    user = authUser({ factors: [totpFactor] });
    await signedIn();
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.account.mfaTitle)).toBeTruthy();
    await press(ar.app.auth.mfaSignOut);
    expect(await screen.findByText('home screen')).toBeTruthy();
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
  });

  it('tells someone without the phone where to write, since nothing opens without the code', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    user = authUser({ factors: [totpFactor] });
    await signedIn();
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.app.auth.mfaLost)).toBeTruthy();
    // The address the website names (config), shown on the button itself.
    await press(new RegExp(`${ar.app.account.contact}.*help@brokersconnect\\.net`));
    expect(open).toHaveBeenCalledWith('mailto:help@brokersconnect.net');
    open.mockRestore();
  });
});

describe('one-tap sign-in', () => {
  it('Apple: the hash of the nonce to Apple, the nonce itself to Supabase, the name kept once', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: false, apple: true } }));
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: 'apple-user',
      state: null,
      identityToken: 'apple-identity-token',
      authorizationCode: 'apple-code',
      fullName: { givenName: 'Sara', familyName: 'Adel', middleName: null, namePrefix: null, nameSuffix: null, nickname: null },
      email: 'relay@privaterelay.appleid.com',
      realUserStatus: 1,
    });
    renderRouter(app, { initialUrl: '/account' });
    await press(ar.nav.signIn);
    await press('Sign in with Apple');

    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    const nonce = 'ab'.repeat(32);
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith(expect.objectContaining({ nonce: `sha256:${nonce}` }));
    const exchange = server.asked('/auth/v1/token').find((request) => request.url.searchParams.get('grant_type') === 'id_token');
    expect(exchange?.body).toMatchObject({ provider: 'apple', id_token: 'apple-identity-token', nonce });
    expect(bodyOf('/auth/v1/user')).toMatchObject({ data: { full_name: 'Sara Adel' } });
    // The Apple ID it was made with, asked about at each launch (tests/apple-credential.test.tsx).
    expect(JSON.parse((await AsyncStorage.getItem('auth:apple-sign-in')) ?? 'null')).toEqual({ userId: USER_ID, appleUser: 'apple-user' });
  });

  it('Google: the system browser, the code back to the app, and PKCE', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: true, apple: true } }));
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: 'success',
      url: 'brokersconnect://auth/callback?code=google-code',
    });
    renderRouter(app, { initialUrl: '/account' });
    await press(ar.nav.signIn);
    await press(ar.auth.continueWithGoogle);

    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    const [authorize, returnTo] = jest.mocked(WebBrowser.openAuthSessionAsync).mock.calls[0];
    const url = new URL(authorize);
    expect(url.pathname).toBe('/auth/v1/authorize');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('brokersconnect://auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    expect(returnTo).toBe('brokersconnect://auth/callback');
    const exchange = server.asked('/auth/v1/token').find((request) => request.url.searchParams.get('grant_type') === 'pkce');
    expect(exchange?.body).toMatchObject({ auth_code: 'google-code' });
  });

  it('Google on Android: the return also arrives as a link, and the code is exchanged once', async () => {
    // Android has no Apple button: Google stands on its own there.
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: true, apple: false } }));
    const back = 'brokersconnect://auth/callback?code=google-code';
    let opened: string | null = 'not asked';
    jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
      // What expo-router does with a link the system hands the app.
      opened = await redirectSystemPath({ path: back, initial: false });
      if (opened) act(() => router.navigate(opened as never));
      return { type: 'success', url: back };
    });
    renderRouter(app, { initialUrl: '/account' });
    await press(ar.nav.signIn);
    await press(ar.auth.continueWithGoogle);

    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    expect(opened).toBeNull();
    const exchanges = server.asked('/auth/v1/token').filter((request) => request.url.searchParams.get('grant_type') === 'pkce');
    expect(exchanges).toHaveLength(1);
    expect(screen.queryByText(ar.common.errorBody)).toBeNull();
    os.restore();
  });

  it('Google: closing the browser is not an error', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: true, apple: true } }));
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
    jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'cancel' } as Awaited<
      ReturnType<typeof WebBrowser.openAuthSessionAsync>
    >);
    renderRouter(app, { initialUrl: '/sign-in' });
    await press(ar.auth.continueWithGoogle);
    await waitFor(() => expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalled());
    // The sheet is usable again, and says nothing went wrong.
    expect(await screen.findByRole('button', { name: ar.auth.continueWithGoogle, disabled: false })).toBeTruthy();
    expect(screen.queryByText(ar.common.errorBody)).toBeNull();
    expect(screen.getByText(ar.auth.signInTitle)).toBeTruthy();
  });
});

describe('a form whose config could not be read', () => {
  it('waits, says so, and reads the config again when asked — never sends without the check', async () => {
    let online = false;
    server.on('GET /api/mobile/v1/config', () =>
      online ? mobileConfig() : { status: 503, body: { error: 'unavailable' } },
    );
    renderRouter(app, { initialUrl: '/sign-up' });
    expect(await screen.findByText(ar.app.auth.configFailed)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.auth.email), 'new@example.com');
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), PASSWORD);
    // Held: whether Supabase asks for a check is not known.
    expect(screen.getByRole('button', { name: ar.auth.signUp }).props.accessibilityState?.disabled).toBe(true);

    online = true;
    fireEvent.press(screen.getByRole('button', { name: ar.app.auth.configRetry }));
    await waitFor(() => expect(screen.queryByText(ar.app.auth.configFailed)).toBeNull());
    await press(ar.auth.signUp);
    expect(await screen.findByText(ar.auth.checkEmailTitle)).toBeTruthy();
  });

  it("says a check the auth server refused is that, not something unknown", async () => {
    server.on('POST /auth/v1/signup', {
      status: 400,
      body: { code: 400, error_code: 'captcha_failed', msg: 'captcha protection: request disallowed (no captcha response)' },
    });
    renderRouter(app, { initialUrl: '/sign-up' });
    fireEvent.changeText(await screen.findByLabelText(ar.auth.email), 'new@example.com');
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), PASSWORD);
    await press(ar.auth.signUp);
    expect(await screen.findByText(ar.auth.errCaptcha)).toBeTruthy();
  });
});

describe('one-tap sign-in, as App Review asks', () => {
  it('offers Google on an iPhone only beside Sign in with Apple', async () => {
    // Google on at the auth server, Apple not set up there yet.
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: true, apple: false } }));
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
    renderRouter(app, { initialUrl: '/sign-in' });
    expect(await screen.findByText(ar.auth.signInTitle)).toBeTruthy();
    await waitFor(() => expect(server.asked('/api/mobile/v1/config').length).toBeGreaterThan(0));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByRole('button', { name: ar.auth.continueWithGoogle })).toBeNull();
  });

  it('offers both once Apple is on', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: true, apple: true } }));
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
    renderRouter(app, { initialUrl: '/sign-in' });
    expect(await screen.findByRole('button', { name: ar.auth.continueWithGoogle })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeTruthy();
  });
});

describe('a forgotten password', () => {
  it('asks the website for the link and answers the same whether or not the address exists', async () => {
    renderRouter(app, { initialUrl: '/sign-in/forgot' });
    fireEvent.changeText(await screen.findByLabelText(ar.auth.email), ' sara@example.com');
    await press(ar.auth.sendResetLink);
    expect(await screen.findByText(ar.auth.resetSent)).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/requestPasswordReset')).toEqual({ input: { email: 'sara@example.com' } });
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/reportAuthOutcome')).toEqual({
        input: { kind: 'reset_requested', email: 'sara@example.com' },
      }),
    );
  });

  it('says so when the address has asked too often', async () => {
    server.on('POST /api/mobile/v1/actions/requestPasswordReset', { ok: false, error: 'wait' });
    renderRouter(app, { initialUrl: '/sign-in/forgot' });
    fireEvent.changeText(await screen.findByLabelText(ar.auth.email), 'sara@example.com');
    await press(ar.auth.sendResetLink);
    expect(await screen.findByText(ar.auth.resendWait)).toBeTruthy();
  });
});

describe('an email link opened in the app', () => {
  const link = (type: string, redirect: string) =>
    `/auth/confirm?token_hash=pkce_0123456789abcdef&type=${type}&redirect_to=${encodeURIComponent(redirect)}`;

  it('confirms a sign-up and carries on to onboarding with the door already chosen', async () => {
    profileRow = null;
    renderRouter(app, {
      initialUrl: link('signup', `${SITE}${confirmationPath({ role: 'employer', next: '/jobs/sales-a1b2' })}`),
    });

    expect(await screen.findByText(ar.onboarding.confirmedBanner)).toBeTruthy();
    expect(screen.getByText(ar.onboarding.roleKnownEmployer)).toBeTruthy();
    expect(bodyOf('/auth/v1/verify')).toMatchObject({ token_hash: 'pkce_0123456789abcdef', type: 'signup' });
  });

  it('closes the sign-up sheet under it too once the account is in, rather than show its "check your email" again', async () => {
    profileRow = null;
    renderRouter(app, { initialUrl: '/sign-up' });
    fireEvent.changeText(await screen.findByLabelText(ar.auth.email), 'new@example.com');
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), PASSWORD);
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), PASSWORD);
    await press(ar.auth.signUp);
    expect(await screen.findByText(ar.auth.checkEmailTitle)).toBeTruthy();

    // The link in the email, opened while the sheet still says to go and find it.
    act(() => router.push(link('signup', `${SITE}${confirmationPath({ role: null, next: null })}`) as never));
    expect(await screen.findByText(ar.onboarding.confirmedBanner)).toBeTruthy();
    await answerOnboarding();

    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/completeOnboarding')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(ar.onboarding.confirmedBanner)).toBeNull());
    expect(screen.queryByText(ar.auth.checkEmailTitle)).toBeNull();
    expect(screen.getByText('home screen')).toBeTruthy();
  });

  it('moves to the second password with the return key, and sets it from there', async () => {
    const focus = watchFocus();
    try {
      renderRouter(app, { initialUrl: link('recovery', `${SITE}/auth/callback?next=/sign-in/new-password`) });
      expect(await screen.findByText(ar.auth.newPasswordTitle)).toBeTruthy();
      fireEvent.changeText(screen.getByLabelText(ar.auth.password), 'a-new-password');
      fireEvent(screen.getByLabelText(ar.auth.password), 'submitEditing');
      expect(focus.focused).toEqual([ar.auth.passwordConfirm]);
      fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'a-new-password');
      fireEvent(screen.getByLabelText(ar.auth.passwordConfirm), 'submitEditing');
      await waitFor(() => expect(server.asked('/api/mobile/v1/actions/announcePasswordChange')).toHaveLength(1));
    } finally {
      focus.undo();
    }
  });

  it('sets a new password from a reset link, ends the other sessions and sends the notice', async () => {
    renderRouter(app, { initialUrl: link('recovery', `${SITE}/auth/callback?next=/sign-in/new-password`) });
    expect(await screen.findByText(ar.auth.newPasswordTitle)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), 'a-new-password');
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'a-new-password');
    await press(ar.auth.resetPassword);

    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/announcePasswordChange')).toHaveLength(1));
    // The password set (a PUT), not the read of who the link's session is.
    expect(server.asked('/auth/v1/user').find((request) => request.method === 'PUT')?.body).toMatchObject({
      password: 'a-new-password',
    });
    expect(server.asked('/auth/v1/logout')[0]?.url.searchParams.get('scope')).toBe('others');
  });

  describe('with an account signed in here', () => {
    const OTHER_ID = '8b7c7f1e-0000-4000-8000-0000000000ee';
    const other = authUser({
      id: OTHER_ID,
      email: 'someone-else@example.com',
      identities: [{ id: OTHER_ID, user_id: OTHER_ID, provider: 'email', identity_data: { email: 'someone-else@example.com' } }],
    });
    /** Supabase's verify, finding the account by the token alone: here, someone else's. */
    const linkFor = (person: AuthUser) => {
      const linked = authSession(person);
      server.on('POST /auth/v1/verify', () => linked);
      // Who a token belongs to, as Supabase answers for it: the link's session is the link's account.
      server.on('GET /auth/v1/user', (_url: URL, init?: RequestInit) =>
        new Headers(init?.headers).get('authorization') === `Bearer ${linked.access_token}` ? person : user,
      );
    };
    const signedInAs = async () => (await supabase.auth.getSession()).data.session?.user.id;

    it("asks, naming both, before another account's link signs this one out — a new address's too", async () => {
      await signedIn();
      linkFor(other);
      renderRouter(app, { initialUrl: link('email_change', `${SITE}/dashboard/profile`) });
      expect(await screen.findByText(ar.app.auth.switchTitle)).toBeTruthy();
      expect(
        screen.getByText(ar.app.auth.switchBody.replace('{email}', user.email).replace('{other}', other.email)),
      ).toBeTruthy();
      // Checked, and nothing of it taken while the question is open.
      expect(server.asked('/auth/v1/verify')).toHaveLength(1);
      expect(await signedInAs()).toBe(USER_ID);

      await press(ar.app.auth.switchCancel);
      expect(await screen.findByText('home screen')).toBeTruthy();
      expect(await signedInAs()).toBe(USER_ID);
    });

    it('switches to the link\'s account when told to', async () => {
      await signedIn();
      linkFor(other);
      renderRouter(app, { initialUrl: link('signup', `${SITE}/auth/callback?next=/onboarding`) });
      await press(ar.app.auth.switchContinue);
      await waitFor(async () => expect(await signedInAs()).toBe(OTHER_ID));
    });

    it("takes this account's own link without a question", async () => {
      await signedIn();
      linkFor(user);
      renderRouter(app, { initialUrl: link('email_change', `${SITE}/dashboard/account`) });
      await waitFor(() => expect(server.asked('/auth/v1/verify')).toHaveLength(1));
      expect(await screen.findByRole('button', { name: ar.app.account.security })).toBeTruthy();
      expect(screen.queryByText(ar.app.auth.switchTitle)).toBeNull();
      expect(await signedInAs()).toBe(USER_ID);
    });

    it('says a link already used is spent, and offers no sign-in to someone signed in', async () => {
      await signedIn();
      server.on('POST /auth/v1/verify', {
        status: 403,
        body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
      });
      renderRouter(app, { initialUrl: link('signup', `${SITE}/auth/callback?next=/onboarding`) });
      expect(await screen.findByText(ar.app.auth.linkUsedTitle)).toBeTruthy();
      expect(screen.getByText(ar.app.auth.linkUsedBody.replace('{email}', user.email))).toBeTruthy();
      expect(screen.queryByText(ar.app.auth.switchTitle)).toBeNull();
      expect(screen.queryByRole('button', { name: ar.nav.signIn })).toBeNull();
    });

    it("asks too while this account's token has run out and its refresh has no answer", async () => {
      // Signed in an hour ago: the token has run out and the auth server is
      // not answering its refresh (no connection, a 503, the app's own hold
      // after a 429). supabase-js answers that nobody is signed in; the phone
      // still has this account, and the app shows it.
      await encryptedSessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ ...authSession(user), expires_at: Math.floor(Date.now() / 1000) - 60 }),
      );
      server.on('POST /auth/v1/token', { status: 503, body: { message: 'unavailable' } });
      linkFor(other);
      renderRouter(app, { initialUrl: link('email_change', `${SITE}/dashboard/profile`) });
      expect(await screen.findByText(ar.app.auth.switchTitle)).toBeTruthy();
      const stored = JSON.parse((await encryptedSessionStorage.getItem(SESSION_KEY)) ?? 'null') as {
        user?: { id: string };
      } | null;
      expect(stored?.user?.id).toBe(USER_ID);
      // supabase-js's own refresh, tried for half a minute, gives up and keeps the session.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
    });

    it('says a new-address link that failed left the change waiting, when one is, and where to ask again', async () => {
      // A change asked for and not yet through: the account still has its old address.
      user = { ...authUser(), new_email: 'new-address@example.com' } as AuthUser;
      await signedIn();
      server.on('POST /auth/v1/verify', {
        status: 403,
        body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
      });
      const withSecurity = { ...app, '(tabs)/(account)/account/security': () => <Text>the security screen</Text> };
      renderRouter(withSecurity, { initialUrl: link('email_change', `${SITE}/dashboard/account`) });
      expect(await screen.findByText(ar.app.auth.emailChangeLinkFailed.replace('{email}', user.email))).toBeTruthy();
      expect(screen.queryByText(ar.app.auth.linkUsedBody.replace('{email}', user.email))).toBeNull();
      expect(screen.queryByRole('button', { name: ar.nav.signIn })).toBeNull();
      await press(ar.app.account.security);
      expect(await screen.findByText('the security screen')).toBeTruthy();
    });

    it('says a new-address link opened again after the change went through is spent, naming the account', async () => {
      // The change went through: the account has its new address, and nothing is waiting.
      user = authUser({ email: 'new-address@example.com' });
      await signedIn();
      server.on('POST /auth/v1/verify', {
        status: 403,
        body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
      });
      renderRouter(app, { initialUrl: link('email_change', `${SITE}/dashboard/account`) });
      expect(await screen.findByText(ar.app.auth.linkUsedBody.replace('{email}', 'new-address@example.com'))).toBeTruthy();
      expect(screen.queryByText(ar.app.auth.emailChangeLinkFailed.replace('{email}', user.email))).toBeNull();
      expect(screen.queryByRole('button', { name: ar.app.account.security })).toBeNull();
    });

    it('reads where a change stands from the server, when it was asked for on another device', async () => {
      // Signed in here before the change was asked for, on the website: the
      // account this phone stored has no new address waiting, the server's has.
      await signedIn();
      user = { ...user, new_email: 'new-address@example.com' } as AuthUser;
      server.on('POST /auth/v1/verify', {
        status: 403,
        body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
      });
      renderRouter(app, { initialUrl: link('email_change', `${SITE}/dashboard/account`) });
      expect(await screen.findByText(ar.app.auth.emailChangeLinkFailed.replace('{email}', user.email))).toBeTruthy();
      expect(screen.getByRole('button', { name: ar.app.account.security })).toBeTruthy();
    });

    it('and from the server when the change went through on another device', async () => {
      // Asked for here, finished on a computer: this phone still has the old
      // address with a change waiting; the server has the new one and nothing waiting.
      user = { ...authUser(), new_email: 'new-address@example.com' } as AuthUser;
      await signedIn();
      user = authUser({ email: 'new-address@example.com' });
      server.on('POST /auth/v1/verify', {
        status: 403,
        body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
      });
      renderRouter(app, { initialUrl: link('email_change', `${SITE}/dashboard/account`) });
      expect(await screen.findByText(ar.app.auth.linkUsedBody.replace('{email}', 'new-address@example.com'))).toBeTruthy();
      expect(screen.queryByRole('button', { name: ar.app.account.security })).toBeNull();
    });

    it('offers a failed reset link the new password here, signed in as the person is', async () => {
      await signedIn();
      server.on('POST /auth/v1/verify', {
        status: 403,
        body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
      });
      renderRouter(app, { initialUrl: link('recovery', `${SITE}/auth/callback?next=/sign-in/new-password`) });
      // Which account the new password would be for: the link may have been another of the person's.
      expect(await screen.findByText(ar.app.auth.resetLinkFailed.replace('{email}', user.email))).toBeTruthy();
      expect(screen.queryByText(ar.app.auth.linkUsedBody.replace('{email}', user.email))).toBeNull();
      expect(screen.getByRole('button', { name: ar.app.account.security })).toBeTruthy();
    });
  });

  it('offers to sign in instead of a spent link, still on the way the link was going', async () => {
    server.on('POST /auth/v1/verify', {
      status: 403,
      body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
    });
    const result = renderRouter(app, {
      initialUrl: link('signup', `${SITE}${confirmationPath({ role: null, next: '/jobs/sales-a1b2' })}`),
    });
    expect(await screen.findByText(ar.auth.linkExpired)).toBeTruthy();
    await press(ar.nav.signIn);
    expect(await screen.findByLabelText(ar.auth.email)).toBeTruthy();
    expect(result.getSearchParams()).toMatchObject({ next: '/jobs/sales-a1b2' });
  });

  it('says a broken or spent link is one, and offers the way forward', async () => {
    server.on('POST /auth/v1/verify', {
      status: 403,
      body: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' },
    });
    renderRouter(app, { initialUrl: link('recovery', `${SITE}/`) });
    expect(await screen.findByText(ar.auth.linkExpired)).toBeTruthy();
    expect(screen.getByRole('button', { name: ar.auth.sendResetLink })).toBeTruthy();
  });

  it('does not send a malformed token anywhere', async () => {
    renderRouter(app, { initialUrl: '/auth/confirm?token_hash=x&type=signup' });
    expect(await screen.findByText(ar.auth.linkExpired)).toBeTruthy();
    expect(server.asked('/auth/v1/verify')).toHaveLength(0);
  });
});

describe('onboarding cut short', () => {
  const LANDING = `/onboarding?confirmed=1&next=${encodeURIComponent('/jobs/sales-a1b2/apply')}`;
  const withApply = { ...app, '(tabs)/(home,account)/jobs/[slug]/apply': () => <Text>the apply form</Text> };

  it('comes back with where the person was going when iOS ended the app, and goes there once done', async () => {
    profileRow = null;
    await signedIn();
    try {
      const first = renderRouter(withApply, { initialUrl: LANDING });
      expect(await screen.findByText(ar.onboarding.confirmedBanner)).toBeTruthy();
      // iOS ends the app while the person is off copying their number.
      first.unmount();

      // Opened again from the icon: the session gate reopens onboarding, with what it had.
      const second = renderRouter(withApply, { initialUrl: '/' });
      expect(await screen.findByText(ar.onboarding.confirmedBanner)).toBeTruthy();
      await answerOnboarding();

      expect(await screen.findByText('the apply form')).toBeTruthy();
      expect(second.getPathname()).toBe('/jobs/sales-a1b2/apply');
      // Arrived: nothing kept to come back to.
      expect(await AsyncStorage.getItem('bc.onboarding-intent.v1')).toBeNull();
    } finally {
      await AsyncStorage.removeItem('bc.onboarding-intent.v1');
    }
  });

  it('forgets the door it came in by once the person signs out of onboarding', async () => {
    profileRow = null;
    await signedIn();
    try {
      const first = renderRouter(app, { initialUrl: '/onboarding?role=employer' });
      expect(await screen.findByText(ar.onboarding.roleKnownEmployer)).toBeTruthy();
      // The wrong door: out, by onboarding's own way out.
      await press(ar.nav.signOut);
      await waitFor(async () => expect((await supabase.auth.getSession()).data.session).toBeNull());
      first.unmount();

      // In again later, with nothing saying which kind of account: asked, not told.
      await signedIn();
      renderRouter(app, { initialUrl: '/onboarding' });
      expect(await screen.findByText(ar.onboarding.roleQuestion)).toBeTruthy();
      expect(screen.queryByText(ar.onboarding.roleKnownEmployer)).toBeNull();
    } finally {
      await AsyncStorage.removeItem('bc.onboarding-intent.v1');
    }
  });
});

describe('deleting the account', () => {
  it('takes the word typed out, then the account', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    const confirm = await screen.findByLabelText(deleteLabel);
    expect(screen.getByRole('button', { name: ar.account.deleteCta }).props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(confirm, ar.account.deleteConfirmWord);
    await press(ar.account.deleteCta);

    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/deleteMyAccount')).toEqual({ input: {} }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(ar.app.account.deleted));
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
  });

  it('takes the English word too, for a keyboard with no Arabic on it (App Review)', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    const confirm = await screen.findByLabelText(deleteLabel);
    const button = () => screen.getByRole('button', { name: ar.account.deleteCta });
    fireEvent.changeText(confirm, 'remove');
    expect(button().props.accessibilityState.disabled).toBe(true);
    // As an English keyboard types it, capital first.
    fireEvent.changeText(confirm, ' Delete ');
    expect(button().props.accessibilityState.disabled).toBe(false);
    await press(ar.account.deleteCta);
    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/deleteMyAccount')).toEqual({ input: {} }));
  });

  it("holds the word any keyboard types to the English catalogue's, and takes no word that is not one", () => {
    expect(DELETE_WORD_ANY_KEYBOARD).toBe(catalogues.en.account.deleteConfirmWord);
    expect(confirmsDeletion(ar.account.deleteConfirmWord, ar.account.deleteConfirmWord)).toBe(true);
    expect(confirmsDeletion('DELETE', ar.account.deleteConfirmWord)).toBe(true);
    expect(confirmsDeletion('', ar.account.deleteConfirmWord)).toBe(false);
    expect(confirmsDeletion('delete my account', ar.account.deleteConfirmWord)).toBe(false);
  });

  it('takes an account deleted whose answer was lost for deleted, as the auth server says', async () => {
    await signedIn();
    // The website deletes the account, and its answer never reaches the phone.
    server.on('POST /api/mobile/v1/actions/deleteMyAccount', () => {
      server.on('GET /auth/v1/user', {
        status: 403,
        body: { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' },
      });
      throw new TypeError('Network request failed');
    });
    renderRouter(app, { initialUrl: '/account/delete' });
    fireEvent.changeText(await screen.findByLabelText(deleteLabel), ar.account.deleteConfirmWord);
    await press(ar.account.deleteCta);

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(ar.app.account.deleted));
    expect(screen.queryByText(ar.account.deleteUnavailable)).toBeNull();
    expect((await supabase.auth.getSession()).data.session).toBeNull();
  });

  it('says it could not delete when the answer was lost and the account is still there', async () => {
    jest.mocked(Alert.alert).mockClear();
    await signedIn();
    server.on('POST /api/mobile/v1/actions/deleteMyAccount', () => {
      throw new TypeError('Network request failed');
    });
    renderRouter(app, { initialUrl: '/account/delete' });
    fireEvent.changeText(await screen.findByLabelText(deleteLabel), ar.account.deleteConfirmWord);
    await press(ar.account.deleteCta);

    expect(await screen.findByText(ar.account.deleteUnavailable)).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalledWith(ar.app.account.deleted);
    expect((await supabase.auth.getSession()).data.session).not.toBeNull();
  });

  it('asks Apple for a fresh code first, for an account made with Apple', async () => {
    user = authUser({
      app_metadata: { provider: 'apple', providers: ['apple'] },
      identities: [{ id: 'apple-user', user_id: USER_ID, provider: 'apple', identity_data: {} }],
    });
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      user: 'apple-user',
      state: null,
      identityToken: null,
      authorizationCode: 'fresh-code',
      fullName: null,
      email: null,
      realUserStatus: 1,
    });
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    expect(await screen.findByText(ar.app.account.deleteApple)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(deleteLabel), ar.account.deleteConfirmWord);
    await press(ar.account.deleteCta);

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/deleteMyAccount')).toEqual({ input: { appleAuthorizationCode: 'fresh-code' } }),
    );
  });

  it('deletes an account made with Apple on Android as the website does, where there is no Apple sheet to ask', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(AppleAuthentication.signInAsync).mockClear();
    try {
      user = authUser({
        app_metadata: { provider: 'apple', providers: ['apple'] },
        identities: [{ id: 'apple-user', user_id: USER_ID, provider: 'apple', identity_data: {} }],
      });
      await signedIn();
      renderRouter(app, { initialUrl: '/account/delete' });
      fireEvent.changeText(
        await screen.findByLabelText(deleteLabel),
        ar.account.deleteConfirmWord,
      );
      expect(screen.queryByText(ar.app.account.deleteApple)).toBeNull();
      await press(ar.account.deleteCta);

      await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/deleteMyAccount')).toEqual({ input: {} }));
      expect(AppleAuthentication.signInAsync).not.toHaveBeenCalled();
      await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(ar.app.account.deleted));
    } finally {
      os.restore();
    }
  });

  it("is refused while a suspension stands, in the website's words", async () => {
    server.on('POST /api/mobile/v1/actions/deleteMyAccount', { ok: false, error: 'under_review' });
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    fireEvent.changeText(
      await screen.findByLabelText(deleteLabel),
      ar.account.deleteConfirmWord,
    );
    await press(ar.account.deleteCta);
    expect(await screen.findByText(ar.account.deleteBlockedSuspended)).toBeTruthy();
  });

  it("is not offered to a company's owner, who asks the team instead and is told how long it takes", async () => {
    profileRow = { ...profile, role: 'employer' };
    companyId = ownedCompany.id;
    server.on('GET /rest/v1/support_requests', []);
    server.on('POST /api/mobile/v1/actions/requestAccountDeletion', { ok: true, data: { reference: 'BC-7K3M-9QX2' } });
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    expect(await screen.findByText(ar.account.deleteBlockedCompany)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.account.deleteCta })).toBeNull();
    expect(screen.getByRole('button', { name: ar.app.account.contact })).toBeTruthy();

    await press(ar.account.deleteRequestCta);
    expect(await screen.findByText(ar.account.deleteRequested.replace('{reference}', 'BC-7K3M-9QX2'))).toBeTruthy();
    const sent = (bodyOf('/api/mobile/v1/actions/requestAccountDeletion') as { input: { key: string; client: string } }).input;
    expect(sent.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sent.client).toMatch(/^Brokers Connect app · ios/);
  });

  it('shows an owner the request they already made, rather than the button again', async () => {
    profileRow = { ...profile, role: 'employer' };
    companyId = ownedCompany.id;
    server.on('GET /rest/v1/support_requests', [{ reference: 'BC-AAAA-BBBB' }]);
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    expect(await screen.findByText(ar.account.deleteRequested.replace('{reference}', 'BC-AAAA-BBBB'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar.account.deleteRequestCta })).toBeNull();
  });

  it("says when the day's requests are used up", async () => {
    profileRow = { ...profile, role: 'employer' };
    companyId = ownedCompany.id;
    server.on('GET /rest/v1/support_requests', []);
    server.on('POST /api/mobile/v1/actions/requestAccountDeletion', { ok: false, error: 'rate_limit' });
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    await press(ar.account.deleteRequestCta);
    expect(await screen.findByText(ar.account.deleteRequestLimited)).toBeTruthy();
  });
});

describe('reporting', () => {
  beforeEach(() => {
    server.on('/api/mobile/v1/companies/nile-brokers', companyPage);
  });

  const reasonNamed = (reason: keyof typeof ar.reportHint) =>
    screen.findByRole('radio', { name: `${ar.reportReason[reason]}. ${ar.reportHint[reason]}` });

  it('sends the reason chosen and the words added, for the team to read', async () => {
    server.on('POST /api/mobile/v1/actions/reportTarget', { ok: true });
    await signedIn();
    renderRouter(app, { initialUrl: '/companies/nile-brokers' });
    await press(ar.companies.report);
    fireEvent.press(await reasonNamed('scam'));
    fireEvent.changeText(screen.getByLabelText(ar.report.detailLabel), ' طلبوا فلوس قبل المقابلة ');
    await press(ar.report.send);

    expect(await screen.findByText(ar.report.thanks)).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/reportTarget')).toEqual({
      input: { target: 'company', targetId: company.id, reason: 'scam', detail: 'طلبوا فلوس قبل المقابلة' },
    });
  });

  it('chooses no reason for the reader, and asks for one', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/companies/nile-brokers' });
    await press(ar.companies.report);
    await press(ar.report.send);
    expect(await screen.findByText(ar.report.chooseReason)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/reportTarget')).toHaveLength(0);
  });

  it('starts empty each time it is opened: no reason left chosen, no refusal left over', async () => {
    server.on('POST /api/mobile/v1/actions/reportTarget', () => {
      throw new TypeError('Network request failed');
    });
    await signedIn();
    renderRouter(app, { initialUrl: '/companies/nile-brokers' });
    await press(ar.companies.report);
    fireEvent.press(await reasonNamed('scam'));
    await press(ar.report.send);
    expect(await screen.findByText(ar.report.network)).toBeTruthy();
    await press(ar.common.close);

    await press(ar.companies.report);
    expect((await reasonNamed('scam')).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.queryByText(ar.report.network)).toBeNull();
  });

  it.each([
    ['already_reported', 'alreadyReported'],
    ['burst_limit', 'burstLimit'],
    ['new_account_limit', 'newAccountLimit'],
    ['own_target', 'ownTarget'],
  ] as const)('says what %s asks of the reader', async (refusal, copy) => {
    server.on('POST /api/mobile/v1/actions/reportTarget', { ok: false, error: refusal });
    await signedIn();
    renderRouter(app, { initialUrl: '/companies/nile-brokers' });
    await press(ar.companies.report);
    fireEvent.press(await reasonNamed('suspicious_company'));
    await press(ar.report.send);
    expect(await screen.findByText(ar.report[copy])).toBeTruthy();
  });
});

afterAll(() => {
  act(() => {});
});
