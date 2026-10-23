import type { ReactNode } from 'react';
import { Linking, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { shownToast, toast } from '~/components/feedback/toast';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as EnrolScreen from '../src/app/mfa-enrol';
import { authSession, authUser, mobileConfig, totpFactor, type AuthUser } from './auth-fixtures';
import { fakeServer } from './server';

/*
  Two-step verification set up on the phone, for the admin console's door
  (src/app/mfa-enrol.tsx): no website, a factor enrolled, added to the
  authenticator app on this phone by its otpauth:// link or by its key, and
  confirmed with its first code — which lifts the session to aal2.
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
const SECRET = 'JBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/Brokers%20Connect:admin@example.com?secret=${SECRET}`;

let user: AuthUser;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
});

beforeEach(async () => {
  user = authUser({ factors: [] });
  server.on('GET /api/mobile/v1/config', mobileConfig({ adminMfaRequired: true }));
  server.on('POST /auth/v1/token', () => authSession(user, user.factors?.some((f) => f.status === 'verified') ? 'aal2' : 'aal1'));
  server.on('POST /auth/v1/logout', {});
  server.on('GET /auth/v1/user', () => user);
  server.on('/rest/v1/profiles', () => []);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('POST /auth/v1/factors', {
    id: totpFactor.id,
    type: 'totp',
    friendly_name: 'Brokers Connect',
    totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET, uri: URI },
  });
  server.on(`POST /auth/v1/factors/${totpFactor.id}/challenge`, { id: 'challenge-1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
  server.on(`POST /auth/v1/factors/${totpFactor.id}/verify`, (_url: URL, init: RequestInit | undefined) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.code !== '123456') {
      return { status: 422, body: { code: 422, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' } };
    }
    user = authUser({ factors: [totpFactor] });
    return authSession(user, 'aal2');
  });
  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
  toast.hide();
});

async function signIn() {
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
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

const app = {
  _layout: Root,
  index: () => <Text>the console</Text>,
  'mfa-enrol': EnrolScreen,
};

describe('setting up two-step verification on the phone', () => {
  it('enrols a factor, offers the authenticator app and the key, and confirms with the first code', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await signIn();
    const result = renderRouter(app, { initialUrl: '/' });
    act(() => router.push('/mfa-enrol'));

    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(server.asked('/auth/v1/factors').find((r) => r.method === 'POST')?.body).toMatchObject({
      factor_type: 'totp',
      friendly_name: 'Brokers Connect',
    });

    fireEvent.press(screen.getByRole('button', { name: ar.app.auth.mfaEnrolOpenApp }));
    expect(openURL).toHaveBeenCalledWith(URI);

    // A wrong code is said so, and nothing is claimed.
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '000000');
    expect(await screen.findByText(ar.account.mfaCodeInvalid)).toBeTruthy();
    expect(shownToast()).toBeNull();

    // The right one, typed on an Arabic keyboard.
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '١٢٣٤٥٦');
    await waitFor(() => expect(result.getPathname()).toBe('/'));
    expect(shownToast()?.message).toBe(ar.account.mfaEnabled);
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(data?.currentLevel).toBe('aal2');
    openURL.mockRestore();
  });

  it('says a failed start failed, with a retry — never a key that does not exist', async () => {
    server.on('POST /auth/v1/factors', { status: 500, body: { msg: 'boom' } });
    await signIn();
    const result = renderRouter(app, { initialUrl: '/' });
    act(() => router.push('/mfa-enrol'));

    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
    server.on('POST /auth/v1/factors', {
      id: totpFactor.id,
      type: 'totp',
      friendly_name: 'Brokers Connect',
      totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET, uri: URI },
    });
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByText(SECRET)).toBeTruthy();
  });
});
