import { Alert, Text } from 'react-native';
import { Stack, Tabs } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { PendingPath } from '~/components/navigation/pending-path';
import { SessionGate } from '~/components/navigation/session-gate';
import { confirmationPath } from '~/features/auth/intent';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { SessionProvider } from '~/lib/session';
import { supabase } from '~/lib/supabase';
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
import * as ConfirmScreen from '../src/app/auth/confirm';
import * as CallbackScreen from '../src/app/auth/callback';
import * as MfaScreen from '../src/app/mfa';
import * as OnboardingScreen from '../src/app/onboarding';
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
  '(auth)/_layout': AuthLayout,
  '(auth)/sign-in/index': SignInScreen,
  '(auth)/sign-in/forgot': ForgotScreen,
  '(auth)/sign-in/new-password': NewPasswordScreen,
  '(auth)/sign-up': SignUpScreen,
  onboarding: OnboardingScreen,
  mfa: MfaScreen,
  'auth/confirm': ConfirmScreen,
  'auth/callback': CallbackScreen,
};

/** Press a button once it can be pressed — the forms wait for the config first. */
async function press(name: string | RegExp) {
  fireEvent.press(await screen.findByRole('button', { name, disabled: false }));
}

async function fillSignIn(email: string, password: string) {
  fireEvent.changeText(await screen.findByLabelText(ar.auth.email), email);
  fireEvent.changeText(screen.getByLabelText(ar.auth.password), password);
}

const bodyOf = (path: string, index = 0) => server.asked(path)[index]?.body as Record<string, unknown> | undefined;

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
    // The name offered is the address's, as on the website when no provider gave one.
    expect(screen.getByDisplayValue('sara')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.fullName), 'سارة عادل');
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.whatsapp), '01001234567');
    fireEvent.press(screen.getByRole('checkbox'));
    await press(ar.onboarding.submit);

    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/completeOnboarding')).toEqual({
      input: { role: 'candidate', fullName: 'سارة عادل', whatsapp: '01001234567', locale: 'ar' },
    });
  });

  it('asks for the Terms before anything is created', async () => {
    profileRow = null;
    await signedIn();
    renderRouter(app, { initialUrl: '/onboarding' });
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.whatsapp), '01001234567');
    await press(ar.onboarding.submit);
    expect(await screen.findByText(ar.app.onboarding.termsRequired)).toBeTruthy();
    expect(server.asked('/api/mobile/v1/actions/completeOnboarding')).toHaveLength(0);
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
    fireEvent.press(await screen.findByRole('radio', { name: `${ar.onboarding.roleEmployer}. ${ar.onboarding.roleEmployerHint}` }));
    fireEvent.changeText(await screen.findByLabelText(ar.onboarding.companyName), 'نايل بروكرز');
    fireEvent.changeText(screen.getByLabelText(ar.onboarding.whatsapp), '12');
    fireEvent.press(screen.getByRole('checkbox'));
    await press(ar.onboarding.submit);

    expect(await screen.findByText(ar.validation.invalidPhone)).toBeTruthy();
    expect(bodyOf('/api/mobile/v1/actions/completeOnboarding')).toEqual({
      input: {
        role: 'employer',
        fullName: 'sara',
        whatsapp: '12',
        locale: 'ar',
        company: { nameAr: 'نايل بروكرز', website: null, headcountBand: null, districtId: null },
      },
    });
  });

  it('opens by itself when a returning session has no profile yet', async () => {
    profileRow = null;
    await signedIn();
    renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.onboarding.title)).toBeTruthy();
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
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '000000');
    await press(ar.account.mfaVerify);
    expect(await screen.findByText(ar.account.mfaCodeInvalid)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '123456');
    await press(ar.account.mfaVerify);
    expect(await screen.findByText(profile.full_name)).toBeTruthy();
    expect(server.asked(`/auth/v1/factors/${totpFactor.id}/verify`).at(-1)?.body).toMatchObject({
      code: '123456',
      challenge_id: 'challenge-1',
    });
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
  });

  it('Google: the system browser, the code back to the app, and PKCE', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: true, apple: false } }));
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

  it('Google: closing the browser is not an error', async () => {
    server.on('GET /api/mobile/v1/config', mobileConfig({ providers: { google: true, apple: false } }));
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

  it('sets a new password from a reset link, ends the other sessions and sends the notice', async () => {
    renderRouter(app, { initialUrl: link('recovery', `${SITE}/auth/callback?next=/sign-in/new-password`) });
    expect(await screen.findByText(ar.auth.newPasswordTitle)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.auth.password), 'a-new-password');
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'a-new-password');
    await press(ar.auth.resetPassword);

    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/announcePasswordChange')).toHaveLength(1));
    expect(bodyOf('/auth/v1/user')).toMatchObject({ password: 'a-new-password' });
    expect(server.asked('/auth/v1/logout')[0]?.url.searchParams.get('scope')).toBe('others');
  });

  it('asks before signing out the account already here', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: link('signup', `${SITE}/auth/callback?next=/onboarding`) });
    expect(await screen.findByText(ar.app.auth.switchTitle)).toBeTruthy();
    expect(screen.getByText(`انت داخل دلوقتي بحساب ${user.email}. اللينك ده هيدخّلك بالحساب اللي اتبعتله الإيميل بداله.`)).toBeTruthy();
    await press(ar.app.auth.switchCancel);
    expect(await screen.findByText('home screen')).toBeTruthy();
    expect(server.asked('/auth/v1/verify')).toHaveLength(0);
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

describe('deleting the account', () => {
  it('takes the word typed out, then the account', async () => {
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    const confirm = await screen.findByLabelText(`اكتب ${ar.account.deleteConfirmWord} عشان تأكّد.`);
    expect(screen.getByRole('button', { name: ar.account.deleteCta }).props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(confirm, ar.account.deleteConfirmWord);
    await press(ar.account.deleteCta);

    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/deleteMyAccount')).toEqual({ input: {} }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(ar.app.account.deleted));
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
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
    fireEvent.changeText(screen.getByLabelText(`اكتب ${ar.account.deleteConfirmWord} عشان تأكّد.`), ar.account.deleteConfirmWord);
    await press(ar.account.deleteCta);

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/deleteMyAccount')).toEqual({ input: { appleAuthorizationCode: 'fresh-code' } }),
    );
  });

  it("is refused while a suspension stands, in the website's words", async () => {
    server.on('POST /api/mobile/v1/actions/deleteMyAccount', { ok: false, error: 'under_review' });
    await signedIn();
    renderRouter(app, { initialUrl: '/account/delete' });
    fireEvent.changeText(
      await screen.findByLabelText(`اكتب ${ar.account.deleteConfirmWord} عشان تأكّد.`),
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
