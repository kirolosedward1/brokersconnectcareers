import Constants from 'expo-constants';
import { AuthRequest, Prompt, ResponseType } from 'expo-auth-session';
import { discovery } from 'expo-auth-session/providers/google';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { defaultLocale } from '@/lib/locale';
import { supabase } from '~/lib/supabase';
import { googleClientId, googleIdTokenRedirect } from './google-client';

type ProviderOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: { message: string; code?: string } | string };

/**
 * Sign in with Google, without sending the person to supabase.co.
 *
 * A build of the app uses Google's own sheet (`@react-native-google-signin`).
 * The sheet returns an identity token and Supabase exchanges it
 * (`signInWithIdToken`). Nothing is opened in the authentication browser, so
 * iOS never asks to use the Supabase host to sign in.
 *
 * That library's original sign-in cannot set a nonce. On iOS the token still
 * carries one, which Google's SDK chose, and GoTrue refuses a token whose
 * nonce the request did not also send — unless the Google provider's
 * "Skip nonce check" is on. The request therefore sends no nonce. Android's
 * token usually has none, which is the other half of the same rule: both
 * absent passes, one of them present does not.
 *
 * Expo Go has no such native module, and neither does a build made before
 * this one was added. There the same exchange runs on an identity token from
 * Google's own authorization endpoint (`accounts.google.com`), through
 * `expo-auth-session`. That request can set a nonce, so it does: Google is
 * given the SHA-256 and Supabase the raw value, the split the website's One
 * Tap uses. A module that will not load is the only reason to take this
 * path. Cancelling the sheet does not open a browser afterwards.
 */

const CANCELLED = { ok: false, cancelled: true } as const;
const failed = (error: { message: string; code?: string } | string): ProviderOutcome => ({ ok: false, cancelled: false, error });

const ANDROID_PACKAGE = 'net.brokersconnect.app';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

function clientIds(): { web: string | null; ios: string | null; android: string | null } {
  return {
    web: googleClientId(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
    ios: googleClientId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    android: googleClientId(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID),
  };
}

/**
 * Whether this phone can ask Google at all. Every way in on an iPhone (the
 * sheet in a build, the browser in Expo Go) needs the iOS client id; on
 * Android the sheet needs the web client and the browser the Android one.
 * Without it the button could only fail, so it is not offered.
 */
export function googleClientReady(
  os: string = Platform.OS,
  ids: { web: string | null; ios: string | null; android: string | null } = clientIds(),
): boolean {
  if (os === 'ios') return Boolean(ids.ios);
  if (os === 'android') return Boolean(ids.web || ids.android);
  return Boolean(ids.web);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The native module is not in this binary: Expo Go, or a build from before it was added. */
function moduleMissing(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return /RNGoogleSignin|TurboModuleRegistry|native module|could not be found|is not a function/i.test(message);
}

function loadGoogle(): GoogleModule | null {
  try {
    // The package reads its native module as it loads, and that throws when
    // the binary does not have it. A static import would throw while the app
    // was opening.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    return null;
  }
}

/**
 * The device's Google sheet. `'unavailable'` when this binary cannot show it,
 * so the caller can ask Google in the browser instead. A cancel is a cancel.
 */
async function nativeGoogleSignIn(): Promise<ProviderOutcome | 'unavailable'> {
  const mod = loadGoogle();
  if (!mod?.GoogleSignin?.signIn) return 'unavailable';

  const ids = clientIds();
  // Android's identity token is issued for the web client. iOS's is issued
  // for the iOS client. Without the one this platform needs, the sheet can
  // succeed and still hand back nothing Supabase will take.
  if (Platform.OS === 'android' && !ids.web) return 'unavailable';
  if (Platform.OS === 'ios' && !ids.ios) return 'unavailable';

  try {
    mod.GoogleSignin.configure({
      webClientId: ids.web ?? undefined,
      iosClientId: ids.ios ?? undefined,
    });
    if (Platform.OS === 'android') {
      const play = await mod.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      if (!play) return failed('google: play services unavailable');
    }
    const response = await mod.GoogleSignin.signIn();
    if (mod.isCancelledResponse(response)) return CANCELLED;
    if (!mod.isSuccessResponse(response) || !response.data.idToken) return failed('google: no identity token');

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.data.idToken,
    });
    return error ? failed(error) : { ok: true };
  } catch (error) {
    if (moduleMissing(error)) return 'unavailable';
    if (
      mod.isErrorWithCode(error) &&
      (error.code === mod.statusCodes.SIGN_IN_CANCELLED || error.code === mod.statusCodes.IN_PROGRESS)
    ) {
      return CANCELLED;
    }
    return failed(error instanceof Error ? error.message : String(error));
  }
}

/**
 * An identity token from Google's authorization endpoint, not from Supabase.
 * The browser is accounts.google.com. The nonce Google copies into the token
 * is the hash; Supabase is given the raw value and hashes it itself.
 */
async function idTokenInTheBrowser(): Promise<ProviderOutcome> {
  const ids = clientIds();
  const packageName = Constants.expoConfig?.android?.package ?? ANDROID_PACKAGE;
  const redirectUri = googleIdTokenRedirect(Platform.OS, ids, packageName);
  const clientId = Platform.OS === 'android' ? ids.android : Platform.OS === 'ios' ? ids.ios : ids.web;
  if (!clientId || !redirectUri) return failed('google: client id is not configured');

  const rawNonce = hex(Crypto.getRandomBytes(32));
  const nonceDigest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const request = new AuthRequest({
    clientId,
    redirectUri,
    responseType: ResponseType.IdToken,
    usePKCE: false,
    scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    prompt: Prompt.SelectAccount,
    extraParams: { nonce: nonceDigest, hl: defaultLocale },
  });

  let result: Awaited<ReturnType<AuthRequest['promptAsync']>>;
  try {
    WebBrowser.maybeCompleteAuthSession();
    result = await request.promptAsync(discovery);
  } catch (error) {
    if (moduleMissing(error)) return failed('google: client id is not configured');
    return failed(error instanceof Error ? error.message : String(error));
  }

  if (result.type === 'cancel' || result.type === 'dismiss') return CANCELLED;
  if (result.type !== 'success' && result.type !== 'error') return failed('google: no identity token');
  const refusal = result.params.error;
  if (refusal === 'access_denied') return CANCELLED;
  if (result.type === 'error' || refusal) {
    return failed(result.params.error_description ?? result.error?.message ?? refusal ?? 'google: no identity token');
  }

  const token = result.params.id_token ?? result.authentication?.idToken;
  if (!token) return failed('google: no identity token');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token,
    nonce: rawNonce,
  });
  return error ? failed(error) : { ok: true };
}

/** `expoGo`: this is Expo Go, where the native module is never loaded. */
export async function signInWithGoogleAccount(expoGo: boolean): Promise<ProviderOutcome> {
  if (!expoGo) {
    const native = await nativeGoogleSignIn();
    if (native !== 'unavailable') return native;
  }
  return idTokenInTheBrowser();
}
