import type { ReactNode } from 'react';
import { Alert, Linking, Pressable, type AlertButton } from 'react-native';
import { Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { rememberActor } from '~/lib/last-actor';
import { SessionProvider, useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { ThemeProvider } from '~/theme/provider';
import * as AccountScreen from '../src/app/(tabs)/(account)/account/index';
import * as EmailsScreen from '../src/app/(tabs)/(account)/account/emails';
import * as SecurityScreen from '../src/app/(tabs)/(account)/account/security';
import { authSession, authUser, mobileConfig, profile, totpFactor, USER_ID, type AuthUser } from './auth-fixtures';
import { phoneFormData, sentBody } from './multipart';
import { watchFocus } from './focus';
import { fakeServer } from './server';

/*
  The account's own settings, as the website's /dashboard/account has them:
  the photo, the email address, the password, the second factor, the emails
  and a copy of the data. The real screens against stand-ins for Supabase
  Auth and the website; what is checked is what each is sent, and what the
  person is told.
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

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => {
  type MockContext = { resize: () => MockContext; renderAsync: () => Promise<{ saveAsync: () => Promise<{ uri: string }> }> };
  const context: MockContext = {
    resize: jest.fn(() => context),
    renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///cache/manipulated.jpg', width: 1024, height: 1024 }) }),
  };
  return { ImageManipulator: { manipulate: jest.fn(() => context) }, SaveFormat: { JPEG: 'jpeg' } };
});
const mockWritten: Record<string, string> = {};
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((...parts: string[]) => {
    const uri = parts.join('/');
    const name = uri.split('/').at(-1) ?? '';
    return {
      uri,
      // As expo-file-system's File: a name, a type from the extension, and its own bytes.
      name,
      type: name.endsWith('.jpg') ? 'image/jpeg' : '',
      bytes: async () => new TextEncoder().encode(`the bytes of ${name}`),
      size: 250_000,
      exists: false,
      create: jest.fn(),
      delete: jest.fn(),
      write: (content: string) => {
        mockWritten[uri] = content;
      },
    };
  }),
}));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));


const ar = catalogues.ar;
const server = fakeServer();
const PASSWORD = 'correct-horse';
const QR = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

let user: AuthUser;
let me: ProfileRow;

beforeAll(() => {
  globalThis.fetch = server.fetch as unknown as typeof fetch;
  globalThis.FormData = phoneFormData();
});

beforeEach(async () => {
  user = authUser();
  me = { ...profile };
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockReset();
  jest.mocked(Sharing.shareAsync).mockClear();

  server.on('GET /api/mobile/v1/config', mobileConfig());
  server.on('POST /auth/v1/token', () =>
    authSession(user, user.factors?.some((factor) => factor.status === 'verified') ? 'aal2' : 'aal1'),
  );
  server.on('POST /auth/v1/logout', {});
  server.on('GET /auth/v1/user', () => user);
  server.on('PUT /auth/v1/user', (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.email === 'taken@example.com') {
      return { status: 422, body: { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' } };
    }
    return user;
  });
  server.on('POST /auth/v1/factors', {
    id: totpFactor.id,
    type: 'totp',
    friendly_name: 'Brokers Connect',
    totp: { qr_code: QR, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Brokers%20Connect:sara@example.com?secret=JBSWY3DPEHPK3PXP' },
  });
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
    user = authUser({ factors: [totpFactor] });
    return authSession(user, 'aal2');
  });
  server.on(`DELETE /auth/v1/factors/${totpFactor.id}`, () => {
    user = authUser();
    return { id: totpFactor.id };
  });
  server.on('/rest/v1/profiles', () => [me]);
  server.on('HEAD /rest/v1/notifications', { body: null, headers: { 'content-range': '*/0' } });
  server.on('POST /api/mobile/v1/actions/uploadImage', () => {
    me = { ...me, avatar_url: 'https://example.supabase.co/storage/v1/object/public/avatars/photo.webp' };
    return { ok: true, data: { url: me.avatar_url } };
  });
  server.on('POST /api/mobile/v1/actions/saveAvatar', { ok: true });
  server.on('POST /api/mobile/v1/actions/announcePasswordChange', { ok: true });
  server.on('POST /api/mobile/v1/actions/updateNotificationPreferences', { ok: true });
  server.on('GET /api/account/export', { exported_at: '2026-09-28T10:00:00Z', account: { id: USER_ID } });

  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.clear();
});

async function signIn(overrides: Partial<AuthUser> = {}) {
  user = authUser(overrides);
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  expect(error).toBeNull();
  await rememberActor({ userId: USER_ID, profile: { role: me.role, approval_status: me.approval_status }, company: null });
  server.requests.length = 0;
}

function Settled({ children }: { children: ReactNode }) {
  return useSession().settled ? children : null;
}

/** What an unsubscribe link or another phone leaves behind: the account read again. */
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

const app = {
  _layout: Root,
  '(tabs)/(account)/_layout': () => <Stack />,
  '(tabs)/(account)/account/index': AccountScreen,
  '(tabs)/(account)/account/security': SecurityScreen,
  '(tabs)/(account)/account/emails': EmailsScreen,
};

const bodyOf = (path: string, index = 0) => server.asked(path)[index]?.body;
/** What Supabase Auth was asked to change (the reads of the user are GETs to the same path). */
const userUpdates = () => server.requests.filter((request) => request.method === 'PUT' && request.url.pathname === '/auth/v1/user');

/** Press the alert's button with this label, as the person would. */
async function answerAlert(label: string) {
  const buttons = (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  await act(async () => {
    await buttons.find((button) => button.text === label)?.onPress?.();
  });
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(Alert.alert).mockClear();
});

describe('the photo', () => {
  it('is picked, cropped square, made a JPEG and sent to the website as the avatar', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library/IMG_0001.HEIC', width: 3024, height: 3024 }],
    } as ImagePicker.ImagePickerResult);
    await signIn();
    renderRouter(app, { initialUrl: '/account' });

    fireEvent.press(await screen.findByRole('button', { name: ar.account.photoUpload }));

    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/uploadImage')).toHaveLength(1));
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }));
    // The request as Expo's fetch builds it on the phone: the picture's own bytes.
    const sent = await sentBody(bodyOf('/api/mobile/v1/actions/uploadImage'));
    expect(sent).toContain('content-disposition: form-data; name="kind"\r\n\r\navatar\r\n');
    expect(sent).toContain(
      'content-disposition: form-data; name="file"; filename="manipulated.jpg"\r\ncontent-type: image/jpeg\r\n\r\nthe bytes of manipulated.jpg\r\n',
    );
    // The profile is read again, and now offers to replace the photo.
    expect(await screen.findByRole('button', { name: ar.account.photoReplace })).toBeTruthy();
  });

  it('stays busy until the new photo can show', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library/IMG_0003.HEIC', width: 2000, height: 2000 }],
    } as ImagePicker.ImagePickerResult);
    await signIn();
    renderRouter(app, { initialUrl: '/account' });
    const upload = await screen.findByRole('button', { name: ar.account.photoUpload });

    // The account's read after the upload, held.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.on('/rest/v1/profiles', async () => (await gate, [me]));
    fireEvent.press(upload);
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/uploadImage')).toHaveLength(1));
    await act(async () => {});
    // Answered, but the photo is not on screen yet: still busy, not offering the same upload again.
    expect(screen.getByRole('button', { name: ar.account.photoUpload }).props.accessibilityState).toMatchObject({ busy: true });

    await act(async () => release());
    expect(await screen.findByRole('button', { name: ar.account.photoReplace })).toBeTruthy();
  });

  it("says what the website refused", async () => {
    server.on('POST /api/mobile/v1/actions/uploadImage', { ok: false, error: 'file_type' });
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///library/IMG_0002.PNG', width: 800, height: 800 }],
    } as ImagePicker.ImagePickerResult);
    await signIn();
    renderRouter(app, { initialUrl: '/account' });

    fireEvent.press(await screen.findByRole('button', { name: ar.account.photoUpload }));
    expect(await screen.findByText(ar.validation.fileType)).toBeTruthy();
  });

  it('is taken off after asking, and only the column is cleared', async () => {
    me = { ...profile, avatar_url: 'https://example.supabase.co/storage/v1/object/public/avatars/photo.webp' };
    await signIn();
    renderRouter(app, { initialUrl: '/account' });

    fireEvent.press(await screen.findByRole('button', { name: `${ar.common.delete}: ${ar.account.photo}` }));
    await answerAlert(ar.common.delete);
    await waitFor(() => expect(bodyOf('/api/mobile/v1/actions/saveAvatar')).toEqual({ input: { storagePath: null } }));
  });
});

describe('signing in and security', () => {
  it('changes the email address through Supabase, and says a confirmation is on its way', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account/security' });

    fireEvent.changeText(await screen.findByLabelText(ar.account.newEmail), 'sara.new@example.com');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save })[0]);

    expect(await screen.findByText(ar.account.emailPending)).toBeTruthy();
    // With the PKCE challenge supabase-js adds; the link itself carries a token hash (see /auth/confirm).
    expect(userUpdates().map((request) => request.body)).toEqual([expect.objectContaining({ email: 'sara.new@example.com' })]);
  });

  it('says so when the address belongs to another account', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account/security' });

    fireEvent.changeText(await screen.findByLabelText(ar.account.newEmail), 'taken@example.com');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save })[0]);
    expect(await screen.findByText(ar.auth.errEmailTaken)).toBeTruthy();
  });

  it("changes the password, ends every other session, and has the website tell the account", async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account/security' });

    fireEvent.changeText(await screen.findByLabelText(ar.account.newPassword), 'short');
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'short');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save })[1]);
    expect(await screen.findByText(ar.validation.passwordShort)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(ar.account.newPassword), 'a-new-password');
    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'a-new-passwort');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save })[1]);
    expect(await screen.findByText(ar.validation.passwordMismatch)).toBeTruthy();
    expect(userUpdates()).toHaveLength(0);

    fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'a-new-password');
    fireEvent.press(screen.getAllByRole('button', { name: ar.common.save })[1]);

    expect(await screen.findByText(ar.account.passwordSaved)).toBeTruthy();
    expect(userUpdates().map((request) => request.body)).toEqual([expect.objectContaining({ password: 'a-new-password' })]);
    await waitFor(() =>
      expect(server.asked('/auth/v1/logout').map((request) => request.url.searchParams.get('scope'))).toEqual(['others']),
    );
    await waitFor(() => expect(server.asked('/api/mobile/v1/actions/announcePasswordChange')).toHaveLength(1));
  });

  it('moves to the second password with the return key, and saves from there', async () => {
    await signIn();
    const focus = watchFocus();
    try {
      renderRouter(app, { initialUrl: '/account/security' });
      fireEvent.changeText(await screen.findByLabelText(ar.account.newPassword), 'a-new-password');
      fireEvent(screen.getByLabelText(ar.account.newPassword), 'submitEditing');
      expect(focus.focused).toEqual([ar.auth.passwordConfirm]);
      fireEvent.changeText(screen.getByLabelText(ar.auth.passwordConfirm), 'a-new-password');
      fireEvent(screen.getByLabelText(ar.auth.passwordConfirm), 'submitEditing');
      expect(await screen.findByText(ar.account.passwordSaved)).toBeTruthy();
    } finally {
      focus.undo();
    }
  });

  it.each([
    ['google', ar.account.oauthOnly],
    ['apple', ar.app.account.oauthOnlyApple],
  ])('offers no password form to an account made with %s', async (provider, copy) => {
    await signIn({
      app_metadata: { provider, providers: [provider] },
      identities: [{ id: 'identity-1', user_id: USER_ID, provider, identity_data: {} }],
    });
    renderRouter(app, { initialUrl: '/account/security' });

    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByLabelText(ar.account.newPassword) === null).toBe(true);
  });

  it('sets up two-step verification: the key opens in an authenticator, then the first code', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no handler'));
    await signIn();
    renderRouter(app, { initialUrl: '/account/security' });

    fireEvent.press(await screen.findByRole('button', { name: ar.account.mfaSetup }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    expect(bodyOf('/auth/v1/factors')).toMatchObject({ factor_type: 'totp', friendly_name: 'Brokers Connect' });

    // No authenticator on this phone: the key is there to type in.
    fireEvent.press(screen.getByRole('button', { name: ar.app.account.mfaOpenApp }));
    expect(await screen.findByText(ar.app.account.mfaNoApp)).toBeTruthy();
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^otpauth:\/\/totp\//));

    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '000000');
    fireEvent.press(screen.getByRole('button', { name: ar.account.mfaVerify }));
    expect(await screen.findByText(ar.account.mfaCodeInvalid)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '123456');
    fireEvent.press(screen.getByRole('button', { name: ar.account.mfaVerify }));
    expect(await screen.findByText(ar.account.mfaEnabled)).toBeTruthy();
  });

  it('takes the first code by itself once six digits are in: the number pad has no return key', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account/security' });
    fireEvent.press(await screen.findByRole('button', { name: ar.account.mfaSetup }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText(ar.account.mfaCode), '123456');
    expect(await screen.findByText(ar.account.mfaEnabled)).toBeTruthy();
  });

  it('clears an abandoned setup before starting again', async () => {
    await signIn({ factors: [{ ...totpFactor, id: 'abandoned', status: 'unverified' }] });
    server.on('DELETE /auth/v1/factors/abandoned', { id: 'abandoned' });
    renderRouter(app, { initialUrl: '/account/security' });

    fireEvent.press(await screen.findByRole('button', { name: ar.account.mfaSetup }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    expect(server.asked('/auth/v1/factors/abandoned').map((request) => request.method)).toEqual(['DELETE']);
  });

  it('turns it off after asking, from a session that has proved it', async () => {
    await signIn({ factors: [totpFactor] });
    renderRouter(app, { initialUrl: '/account/security' });

    expect(await screen.findByText(ar.account.mfaEnabled)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ar.account.mfaDisable }));
    await answerAlert(ar.account.mfaDisable);

    expect(await screen.findByRole('button', { name: ar.account.mfaSetup })).toBeTruthy();
    expect(server.asked(`/auth/v1/factors/${totpFactor.id}`).map((request) => request.method)).toEqual(['DELETE']);
  });
});

describe('the emails', () => {
  it("shows a candidate's switches and sends all four when one is flipped", async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account/emails' });

    const digest = await screen.findByLabelText(ar.account.notifyDigest);
    expect(screen.queryByLabelText(ar.account.notifyApplications) === null).toBe(true);
    fireEvent(digest, 'valueChange', false);

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/updateNotificationPreferences')).toEqual({
        input: { notify_applications: true, notify_status: true, notify_digest: false, notify_applicant_digest: false },
      }),
    );
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();
  });

  it('keeps up with a switch turned off elsewhere, and does not turn it back on with the next flip', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account/emails' });
    expect((await screen.findByLabelText(ar.account.notifyDigest)).props.value).toBe(true);

    // Turned off from an email's unsubscribe link while this was open.
    me = { ...me, notify_digest: false };
    fireEvent.press(screen.getByRole('button', { name: 'read the account again' }));
    await waitFor(() => expect(screen.getByLabelText(ar.account.notifyDigest).props.value).toBe(false));

    fireEvent(screen.getByLabelText(ar.account.notifyStatus), 'valueChange', false);
    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/updateNotificationPreferences')).toEqual({
        input: { notify_applications: true, notify_status: false, notify_digest: false, notify_applicant_digest: false },
      }),
    );
  });

  it('follows a switch flipped here once it is saved, when it is changed again elsewhere', async () => {
    server.on('POST /api/mobile/v1/actions/updateNotificationPreferences', (_url: URL, init?: RequestInit) => {
      me = { ...me, ...(JSON.parse(String(init?.body)) as { input: Partial<ProfileRow> }).input };
      return { ok: true };
    });
    await signIn();
    renderRouter(app, { initialUrl: '/account/emails' });
    fireEvent(await screen.findByLabelText(ar.account.notifyDigest), 'valueChange', false);
    expect(await screen.findByText(ar.common.saveSuccess)).toBeTruthy();

    // Turned back on from another phone since.
    me = { ...me, notify_digest: true };
    fireEvent.press(screen.getByRole('button', { name: 'read the account again' }));
    await waitFor(() => expect(screen.getByLabelText(ar.account.notifyDigest).props.value).toBe(true));
  });

  it('offers the profile reminder, off, where the profile has the switch, and sends it with the rest', async () => {
    me = { ...me, notify_profile_nudge: false };
    await signIn();
    renderRouter(app, { initialUrl: '/account/emails' });

    const reminder = await screen.findByLabelText(ar.account.notifyProfileNudge);
    expect(reminder.props.value).toBe(false);
    fireEvent(reminder, 'valueChange', true);

    await waitFor(() =>
      expect(bodyOf('/api/mobile/v1/actions/updateNotificationPreferences')).toEqual({
        input: {
          notify_applications: true,
          notify_status: true,
          notify_digest: true,
          notify_applicant_digest: false,
          notify_profile_nudge: true,
        },
      }),
    );
  });

  it('does not offer the reminder where the database has no such switch yet', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account/emails' });
    expect(await screen.findByLabelText(ar.account.notifyDigest)).toBeTruthy();
    expect(screen.queryByLabelText(ar.account.notifyProfileNudge)).toBeNull();
  });

  it('puts the switch back when the website refuses', async () => {
    server.on('POST /api/mobile/v1/actions/updateNotificationPreferences', { ok: false, error: 'invalid' });
    await signIn();
    renderRouter(app, { initialUrl: '/account/emails' });

    fireEvent(await screen.findByLabelText(ar.account.notifyStatus), 'valueChange', false);
    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    expect(screen.getByLabelText(ar.account.notifyStatus).props.value).toBe(true);
  });
});

describe('the appearance', () => {
  it('is one choice of three: radio buttons in a group named for what they set', async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account' });

    expect((await screen.findByLabelText(ar.app.account.appearance)).props.accessibilityRole).toBe('radiogroup');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    fireEvent.press(screen.getByRole('radio', { name: ar.theme.dark }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: ar.theme.dark }).props.accessibilityState).toMatchObject({ checked: true }),
    );
    expect(screen.getByRole('radio', { name: ar.theme.light }).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByRole('radio', { name: ar.theme.system }).props.accessibilityState).toMatchObject({ checked: false });
  });
});

describe('a profile that could not be read', () => {
  it('says so with a way to try again, rather than waiting for ever', async () => {
    let down = true;
    // A 500, which the client does not retry (a 503 it retries for a while first).
    server.on('/rest/v1/profiles', () => (down ? { status: 500, body: { message: 'failed' } } : [me]));
    await signIn();
    renderRouter(app, { initialUrl: '/account/emails' });

    expect(await screen.findByText(ar.common.errorBody)).toBeTruthy();
    down = false;
    fireEvent.press(screen.getByRole('button', { name: ar.common.retry }));
    expect(await screen.findByLabelText(ar.account.notifyDigest)).toBeTruthy();
  });
});

describe('a copy of the data', () => {
  it("is the website's export, handed to the share sheet", async () => {
    await signIn();
    renderRouter(app, { initialUrl: '/account' });

    fireEvent.press(await screen.findByRole('button', { name: ar.account.exportCta }));

    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    const [uri, options] = jest.mocked(Sharing.shareAsync).mock.calls[0];
    expect(uri).toBe(`file:///cache/brokers-connect-data-${USER_ID.slice(0, 8)}.json`);
    expect(options).toMatchObject({ mimeType: 'application/json' });
    expect(JSON.parse(mockWritten[uri])).toMatchObject({ account: { id: USER_ID } });
    // Asked as the person: the token rides along.
    expect(server.asked('/api/account/export')).toHaveLength(1);
    // Shared, the copy leaves the phone: the person's whole account, in the cache.
    const written = jest.mocked(File).mock.results.map((made) => made.value as { uri: string; delete: jest.Mock });
    await waitFor(() => expect(written.find((made) => made.uri === uri)?.delete).toHaveBeenCalled());
  });

  it('says when the day’s copies are used up', async () => {
    server.on('GET /api/account/export', { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 3600 } });
    await signIn();
    renderRouter(app, { initialUrl: '/account' });

    fireEvent.press(await screen.findByRole('button', { name: ar.account.exportCta }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(ar.account.exportTitle, ar.app.account.exportLimit));
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});
