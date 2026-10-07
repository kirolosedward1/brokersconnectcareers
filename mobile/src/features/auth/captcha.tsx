import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { useMobileConfig } from '~/features/config';
import { env } from '~/lib/env';
import { useTheme } from '~/theme/provider';
import { corner } from '~/theme/tokens';

/**
 * Cloudflare Turnstile for the password forms, as the website runs it.
 *
 * Supabase Auth asks for a Turnstile token with a password sign-in, a sign-up
 * and a reset request when CAPTCHA protection is on — /api/mobile/v1/config
 * says whether it is, by naming a site key. Turnstile only runs on the hostnames
 * that key allows, and an app has none, so the widget runs in a WebView on the
 * website's own page (/api/mobile/v1/captcha), kept out of sight. For nearly
 * everyone it finishes on its own and hands over a token; when Cloudflare wants
 * a person, the page says so and the widget is shown where the form can be
 * seen, exactly as the website shows it.
 *
 * A token is single-use: Supabase spends it on the request that carries it.
 * After every attempt the form calls `renew()`, which loads a fresh page.
 */

export type CaptchaAction = 'sign-in' | 'sign-up' | 'reset';

/** What the captcha page posts to the app (see src/app/api/mobile/v1/captcha on the website). */
export type CaptchaMessage =
  | { type: 'interactive' }
  | { type: 'token'; token: string }
  | { type: 'expired' }
  | { type: 'timeout' }
  | { type: 'error'; code: string }
  | { type: 'unavailable' };

/**
 * `off`: no captcha is asked for. `checking`: the widget is working, or has
 * not loaded yet. `ready`: a token is in hand. `interactive`: Cloudflare wants
 * the person to tap the box. `failed`: the widget could not run.
 */
/**
 * 'unknown': the config could not be read, so whether a check is asked for is
 * not known — and a form sent without one, where Supabase asks for it, is
 * refused every time, while nothing reads the config again with the form open.
 */
export type CaptchaStatus = 'off' | 'unknown' | 'checking' | 'ready' | 'interactive' | 'failed';

/** A message from the page, or null for anything else a web page might post. */
export function parseCaptchaMessage(data: string): CaptchaMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const message = value as { type?: unknown; token?: unknown; code?: unknown };

  switch (message.type) {
    case 'token':
      // Turnstile tokens run to a couple of kilobytes; Supabase refuses more than it needs.
      return typeof message.token === 'string' && message.token.length > 0 && message.token.length <= 4096
        ? { type: 'token', token: message.token }
        : null;
    case 'error':
      return { type: 'error', code: typeof message.code === 'string' ? message.code : '' };
    case 'interactive':
    case 'expired':
    case 'timeout':
    case 'unavailable':
      return { type: message.type };
    default:
      return null;
  }
}

/** The page for one action, drawn in the app's theme. */
export function captchaUrl(site: string, action: CaptchaAction, theme: 'light' | 'dark'): string {
  return `${site}/api/mobile/v1/captcha?action=${action}&theme=${theme}`;
}

/**
 * What the WebView may load: the captcha page itself as the document, and
 * Cloudflare's challenge frames inside it. Nothing else — a link inside the
 * widget (Cloudflare's privacy notice) opens in the browser instead.
 */
export function allowCaptchaLoad(request: { url: string; isTopFrame?: boolean }, page: string): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.protocol === 'about:') return true;
  if (request.isTopFrame === false) {
    return url.protocol === 'https:' && url.hostname === 'challenges.cloudflare.com';
  }
  const expected = new URL(page);
  return url.origin === expected.origin && url.pathname === expected.pathname;
}

function openOutside(url: string | undefined) {
  if (url && /^https:\/\//i.test(url)) WebBrowser.openBrowserAsync(url).catch(() => {});
}

export function useCaptcha(action: CaptchaAction) {
  const config = useMobileConfig();
  const enabled = Boolean(config.data?.turnstileSiteKey);
  const [generation, setGeneration] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Exclude<CaptchaStatus, 'off'>>('checking');

  const onMessage = useCallback((message: CaptchaMessage) => {
    switch (message.type) {
      case 'token':
        setToken(message.token);
        setStatus('ready');
        break;
      case 'interactive':
        setStatus('interactive');
        break;
      // The widget refreshes itself after either; the next token follows.
      case 'expired':
      case 'timeout':
        setToken(null);
        setStatus('checking');
        break;
      case 'error':
      case 'unavailable':
        setToken(null);
        setStatus('failed');
        break;
    }
  }, []);

  /** The token was spent (or the widget failed): load the page again for another. */
  const renew = useCallback(() => {
    setToken(null);
    setStatus('checking');
    setGeneration((n) => n + 1);
  }, []);

  const known = Boolean(config.data);
  return {
    /** Not yet known whether one is needed: the config has not answered. */
    loading: config.isPending,
    status: !known && !config.isPending ? ('unknown' as const) : enabled ? status : ('off' as const),
    /** The config read again, after it could not be ('unknown'). */
    retry: () => void config.refetch(),
    retrying: config.isFetching,
    /** Sent with the request, or omitted when no captcha is asked for. */
    token: enabled ? token : null,
    renew,
    view: enabled ? (
      <CaptchaView key={generation} action={action} visible={status === 'interactive'} onMessage={onMessage} />
    ) : null,
  };
}

/**
 * The page, drawn at the widget's size. Out of sight — present, running, not
 * seen or reachable by VoiceOver — until Cloudflare asks for the person.
 */
function CaptchaView({
  action,
  visible,
  onMessage,
}: {
  action: CaptchaAction;
  visible: boolean;
  onMessage: (message: CaptchaMessage) => void;
}) {
  const { scheme } = useTheme();
  const page = captchaUrl(env.siteUrl, action, scheme);

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={
        visible
          ? { height: 72, ...corner('lg'), overflow: 'hidden' }
          : { position: 'absolute', width: 300, height: 72, opacity: 0 }
      }
    >
      <WebView
        source={{ uri: page }}
        style={{ backgroundColor: 'transparent' }}
        containerStyle={{ backgroundColor: 'transparent' }}
        onMessage={(event) => {
          const message = parseCaptchaMessage(event.nativeEvent.data);
          if (message) onMessage(message);
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (allowCaptchaLoad(request, page)) return true;
          if (request.navigationType === 'click') openOutside(request.url);
          return false;
        }}
        onOpenWindow={(event) => openOutside(event.nativeEvent.targetUrl)}
        onError={() => onMessage({ type: 'unavailable' })}
        onHttpError={() => onMessage({ type: 'unavailable' })}
        scrollEnabled={false}
        bounces={false}
        allowsLinkPreview={false}
        dataDetectorTypes="none"
      />
    </View>
  );
}
