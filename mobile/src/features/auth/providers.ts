import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { suggestedDisplayName } from '@/lib/auth/suggested-name';
import { supabase } from '~/lib/supabase';
import { rememberAppleSignIn } from './apple-credential';
import { awaitingOAuthReturn, OAUTH_REDIRECT } from './oauth-return';

/**
 * The one-tap sign-ins, as the phone does them.
 *
 * Apple on iOS: the system sheet, not a web page. Apple signs an identity
 * token for this app, bound to a nonce; Supabase checks the token and the
 * nonce and issues a session (`signInWithIdToken`). The nonce Apple sees is
 * the SHA-256 of the one Supabase is given, so a token lifted from Apple's
 * response is no use to anyone who does not also hold the original. Android
 * has no system sheet, so Apple there is the same browser sign-in as Google.
 *
 * Google: Supabase's own OAuth flow, in the system's authentication browser
 * (ASWebAuthenticationSession — Google refuses sign-ins in embedded web views).
 * PKCE: the verifier stays in this app's encrypted storage and the browser
 * only ever returns a one-time code to brokersconnect://auth/callback, which
 * the Supabase project must list as an allowed redirect.
 *
 * Neither needs a captcha: Supabase asks for one only with a password.
 */

export { OAUTH_REDIRECT };

export type ProviderOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: { message: string; code?: string } | string };

const CANCELLED = { ok: false, cancelled: true } as const;
const failed = (error: { message: string; code?: string } | string): ProviderOutcome => ({ ok: false, cancelled: false, error });

function isCancel(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED';
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Running in Expo Go: a tester's phone, never App Review's, which sees the app itself. */
export function inExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * The system Sign in with Apple sheet, where it can work: iOS, and not Expo
 * Go, which the phone offers it to but which Apple then issues the token to,
 * under Expo Go's own bundle id, and Supabase refuses it. Android has no
 * sheet; it uses the browser (signInWithApple).
 */
export function appleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || inExpoGo()) return Promise.resolve(false);
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/**
 * Whether "Continue with Google" is offered: when the auth server takes it,
 * and on an iPhone only beside Sign in with Apple — an app that offers a
 * third-party sign-in must offer Apple's as well (App Review 4.8), and the
 * auth server can have Google on with Apple not yet set up. Except in Expo Go,
 * where Apple's cannot work at all (above): there Google stands alone.
 */
export function offerGoogle({ google, apple, ios }: { google: boolean; apple: boolean; ios: boolean }): boolean {
  return google && (!ios || apple || inExpoGo());
}

export async function signInWithApple(): Promise<ProviderOutcome> {
  if (Platform.OS !== 'ios') return signInWithBrowser('apple');
  return signInWithAppleNative();
}

async function signInWithAppleNative(): Promise<ProviderOutcome> {
  const nonce = hex(Crypto.getRandomBytes(32));
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    return isCancel(error) ? CANCELLED : failed(error instanceof Error ? error.message : String(error));
  }
  if (!credential.identityToken) return failed('apple: no identity token');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });
  if (error) return failed(error);
  // Asked about at each launch from now on: a session made with this Apple ID ends here when Apple revokes it.
  if (data.user) await rememberAppleSignIn(data.user.id, credential.user);

  /*
    Apple gives the name once — on the first sign-in with this app — and never
    again, and the identity token does not carry it. Kept where the website
    keeps a provider's name (user_metadata.full_name). Onboarding writes that
    onto the profile (completeOnboarding); with no usable name the field is
    empty and that step asks. A private-relay address is never the name.
    A failure here costs a pre-filled field.
  */
  const email = data.user?.email ?? credential.email;
  const name = suggestedDisplayName({
    metadata: { full_name: credential.fullName ? AppleAuthentication.formatFullName(credential.fullName) : '' },
    email,
    providers: ['apple'],
  });
  if (name) await supabase.auth.updateUser({ data: { full_name: name } }).catch(() => {});

  return { ok: true };
}

/**
 * A fresh authorization code from Apple, for deleting an account made with
 * it: the website trades the code for a token and revokes it, so the app
 * leaves the person's Apple ID along with the account. Null if they cancel.
 */
export async function appleAuthorizationCode(): Promise<string | null> {
  try {
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    return credential.authorizationCode ?? null;
  } catch {
    return null;
  }
}

export function signInWithGoogle(): Promise<ProviderOutcome> {
  return signInWithBrowser('google');
}

/**
 * Supabase's OAuth in the system browser. Apple on Android uses it too: the
 * name, when Apple sends one, is stored by Supabase on the way back. Scopes
 * `name email` are what ask Apple for that name the first time.
 */
async function signInWithBrowser(provider: 'google' | 'apple'): Promise<ProviderOutcome> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: OAUTH_REDIRECT,
      skipBrowserRedirect: true,
      ...(provider === 'apple' ? { scopes: 'name email' } : {}),
    },
  });
  if (error) return failed(error);
  if (!data.url) return failed(`${provider}: no authorization url`);

  const authorize = data.url;
  return awaitingOAuthReturn(async () => {
    const result = await WebBrowser.openAuthSessionAsync(authorize, OAUTH_REDIRECT);
    if (result.type !== 'success') return CANCELLED;
    return completeOAuth(result.url);
  });
}

/**
 * The callback's answer: a code to exchange for a session, or the provider's
 * refusal. Supabase puts an error in the query, or in the fragment when it
 * never reached the code step. Declining on Google's own page is a cancel.
 */
export async function completeOAuth(url: string): Promise<ProviderOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failed('oauth: unreadable callback');
  }
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const read = (name: string) => parsed.searchParams.get(name) ?? fragment.get(name);

  const error = read('error');
  if (error === 'access_denied') return CANCELLED;
  if (error) return failed({ message: read('error_description') ?? error, code: read('error_code') ?? undefined });

  const code = read('code');
  if (!code) return failed('oauth: no code');
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  return exchanged.error ? failed(exchanged.error) : { ok: true };
}
