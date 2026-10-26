import { isInApp } from '@/lib/app-view';
import { locales } from '@/lib/locale';
import { stripLocalePrefix } from '@/lib/safe-next';

/**
 * Google One Tap on the public site.
 *
 * The client id is `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, the same web client the
 * Google provider uses. That variable is server-only: it has no `NEXT_PUBLIC_`
 * prefix, so the browser bundle does not contain it. The site layout reads it
 * and passes {@link clientIdForOneTap} down as the `clientId` prop. GIS has to
 * be given that same id or GoTrue rejects the ID token (`aud`). The secret
 * never comes here.
 *
 * `supabase/config.toml` sets the id for the local CLI only. The hosted
 * project's Google provider is a separate setting and is not changed here.
 *
 * The nonce is the split Supabase documents for `signInWithIdToken`. Google
 * copies the nonce it is given into the ID token unchanged. GoTrue hashes the
 * nonce it is given (SHA-256, hex) and compares. So Google receives the hash
 * and Supabase receives the raw value. A token lifted out of the prompt is
 * useless without the raw nonce, which never leaves this page.
 */

/** Remembering a close, for this tab only. Listed on the cookie page. */
export const ONE_TAP_CLOSED_KEY = 'bc.google-one-tap';

/**
 * Google Identity Services, as Google documents the script URL. `hl` is how
 * One Tap's own UI is localised — the prompt is Google's and is not restyled.
 *
 * Arabic is the default locale, served at `/` with no prefix (`localePrefix:
 * 'as-needed'`). `/ar` is the same locale when a prefix is present. Callers
 * pass the page locale, not the raw path, so both get `hl=ar`.
 */
const GSI_CLIENT = 'https://accounts.google.com/gsi/client';

export function gsiScriptSrc(locale: string): string {
  const hl = locale === 'ar' ? 'ar' : 'en';
  return `${GSI_CLIENT}?hl=${hl}`;
}

/**
 * A web client id. The e2e stand-in (`e2e`) and anything that is not Google's
 * public web client id must not be handed to GIS.
 */
export function isGoogleWebClientId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9]{6,}-[0-9A-Za-z_-]{6,}\.apps\.googleusercontent\.com$/.test(value);
}

/**
 * The `clientId` prop the server passes to `<GoogleOneTap>`.
 *
 * Call with `process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID` from a Server
 * Component. A placeholder (`REPLACE_ME…`, as `.env.vercel.local` ships it),
 * the e2e stand-in, or anything else that is not a web client id returns
 * `undefined`, and the layout does not mount One Tap.
 */
export function clientIdForOneTap(raw: string | null | undefined): string | undefined {
  if (!raw || raw.startsWith('REPLACE_ME')) return undefined;
  return isGoogleWebClientId(raw) ? raw : undefined;
}

const JOB_DETAIL = /^\/jobs\/[^/]+$/;

/**
 * Where One Tap may appear: the home page, the jobs list, and a job's own
 * page. Not the apply form, not the sign-in or sign-up doors, not the rest
 * of the site. An allow-list, so a new public page does not inherit the prompt.
 *
 * Accepts the locale-stripped path next-intl's `usePathname` returns, and a
 * full path (`/en/jobs`, `/ar`) in case it is given one.
 */
export function isOneTapPage(pathname: string): boolean {
  const bare = (pathname.split(/[?#]/, 1)[0] || '/').replace(/\/+$/, '') || '/';
  const path = stripLocalePrefix(bare, locales);
  return path === '/' || path === '/jobs' || JOB_DETAIL.test(path);
}

export function shouldShowGoogleOneTap(input: {
  pathname: string;
  /** A session is already in hand, or the chrome request is still in flight. */
  signedIn: boolean;
  sessionPending: boolean;
  dismissedThisSession: boolean;
  /** Already-computed WebView flag. The raw signals below are checked too. */
  webView?: boolean;
  userAgent?: string | null;
  reactNativeWebView?: boolean;
  /** `location.search`, including a leading `?`. `?app=1` hides the prompt. */
  search?: string | null;
  /** `document.cookie`. `bc_app=1` hides the prompt. */
  cookie?: string | null;
  /** GoTrue reports the Google provider as enabled. */
  googleEnabled: boolean;
  clientId: string | null | undefined;
}): boolean {
  if (input.signedIn || input.sessionPending) return false;
  if (input.dismissedThisSession || isInApp(input)) return false;
  if (!input.googleEnabled || !isGoogleWebClientId(input.clientId)) return false;
  return isOneTapPage(input.pathname);
}

/**
 * What `google.accounts.id.initialize` is given.
 *
 * `use_fedcm_for_prompt` asks GIS to use FedCM where the browser supports it
 * and to keep the legacy prompt where it does not. Nothing else is set.
 * `auto_select` would sign in without a tap. `cancel_on_tap_outside` would
 * override Google's own dismissal. `prompt_parent_id` would move the prompt
 * into our layout. Google's cooldown (the `g_state` cookie) is left alone —
 * this never clears it and never passes a flag that skips it.
 */
export function googleInitializeOptions(input: {
  clientId: string;
  /** The SHA-256 hex of the raw nonce. Google puts this value in the token. */
  googleNonce: string;
  callback: (response: { credential?: string }) => void;
}): {
  client_id: string;
  callback: (response: { credential?: string }) => void;
  nonce: string;
  use_fedcm_for_prompt: true;
} {
  return {
    client_id: input.clientId,
    callback: input.callback,
    nonce: input.googleNonce,
    use_fedcm_for_prompt: true,
  };
}

/**
 * The visitor closed the prompt, as opposed to us cancelling it on the way
 * off an eligible page or a credential coming back.
 *
 * FedCM does not report `user_cancel` / `tap_outside`. A dismissed moment
 * whose reason is not one of Google's three non-close reasons is the visitor
 * closing it. `cancel_called` is our own `google.accounts.id.cancel()`.
 */
export function oneTapClosedByVisitor(moment: {
  isSkippedMoment?: () => boolean;
  getSkippedReason?: () => string;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
}): boolean {
  try {
    if (moment.isSkippedMoment?.()) {
      const reason = moment.getSkippedReason?.() ?? '';
      return reason === 'user_cancel' || reason === 'tap_outside';
    }
    if (moment.isDismissedMoment?.()) {
      const reason = moment.getDismissedReason?.() ?? '';
      return reason !== 'credential_returned' && reason !== 'cancel_called' && reason !== 'flow_restarted';
    }
  } catch {
    return false;
  }
  return false;
}

/** 32 random bytes, hex. No `+`, `/` or `=` — those have been mangled in transit. */
export function createNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

/** SHA-256 of the raw nonce, lowercase hex. This is the value Google is given. */
export async function hashNonce(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return hex(new Uint8Array(digest));
}

/**
 * One pair. `supabaseNonce` is passed to `signInWithIdToken` unchanged.
 * `googleNonce` is passed to GIS.
 */
export async function googleOneTapNonce(): Promise<{ supabaseNonce: string; googleNonce: string }> {
  const supabaseNonce = createNonce();
  return { supabaseNonce, googleNonce: await hashNonce(supabaseNonce) };
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** The visitor closed One Tap. This tab does not prompt again. */
export function rememberOneTapClosed(): void {
  try {
    sessionStorage.setItem(ONE_TAP_CLOSED_KEY, '1');
  } catch {
    // Private mode can refuse storage. Google's own cooldown still applies.
  }
}

export function oneTapClosedThisSession(): boolean {
  try {
    return sessionStorage.getItem(ONE_TAP_CLOSED_KEY) === '1';
  } catch {
    return false;
  }
}
