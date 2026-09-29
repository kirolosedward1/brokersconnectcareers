import { NextResponse, type NextRequest } from 'next/server';
import { configuredValue } from '@/lib/env';
import { defaultLocale, dirOf } from '@/lib/locale';

/**
 * GET /api/mobile/v1/captcha?action=sign-in&theme=dark — Cloudflare Turnstile
 * for the iOS app.
 *
 * Supabase Auth asks for a Turnstile token on password sign-in, sign-up and
 * reset when CAPTCHA protection is on. Turnstile runs only on the hostnames the
 * site key allows, and an app has no hostname, so the app loads this page from
 * the website in a WebView it keeps out of sight. The widget runs as on the
 * website — `interaction-only`, so for nearly everyone nothing is ever drawn —
 * and the page tells the app what happened through the WebView's message
 * channel:
 *
 *   { type: 'interactive' }         Cloudflare wants a person: show the sheet
 *   { type: 'token', token }        a single-use token, good for 300 seconds
 *   { type: 'expired' | 'timeout' } the token lapsed; the widget makes another
 *   { type: 'error', code }         say so, and let the app retry
 *   { type: 'unavailable' }         the script could not load
 *
 * One token per attempt: Supabase spends it on the request that carries it.
 * The app keeps a page warm and asks for a fresh token before each attempt.
 *
 * Bare HTML with no site layout, no cookies, and nothing to index. The site's
 * CSP already allows challenges.cloudflare.com wherever a site key is set.
 */
export const dynamic = 'force-dynamic';

/** Labels Cloudflare shows in its analytics; the same names the website's forms use. */
const ACTIONS = new Set(['sign-in', 'sign-up', 'reset']);

export function GET(request: NextRequest) {
  const siteKey = configuredValue(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  if (!siteKey) {
    return NextResponse.json({ error: 'captcha_disabled' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const params = request.nextUrl.searchParams;
  const action = ACTIONS.has(params.get('action') ?? '') ? (params.get('action') as string) : 'sign-in';
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';

  return new NextResponse(page({ siteKey, action, theme }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function page({ siteKey, action, theme }: { siteKey: string; action: string; theme: 'light' | 'dark' }): string {
  // Everything interpolated is either a fixed word from above or the site key,
  // which is public; JSON.stringify keeps each a string literal in the script.
  const options = JSON.stringify({ sitekey: siteKey, action, theme, language: defaultLocale });

  return `<!doctype html>
<html lang="${defaultLocale}" dir="${dirOf(defaultLocale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  body { display: flex; align-items: center; justify-content: center; }
</style>
</head>
<body>
<div id="widget"></div>
<script>
  function send(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  var options = ${options};
  window.onTurnstileLoad = function () {
    try {
      window.turnstile.render('#widget', {
        sitekey: options.sitekey,
        action: options.action,
        theme: options.theme,
        language: options.language,
        appearance: 'interaction-only',
        'before-interactive-callback': function () { send({ type: 'interactive' }); },
        callback: function (token) { send({ type: 'token', token: token }); },
        'expired-callback': function () { send({ type: 'expired' }); },
        'timeout-callback': function () { send({ type: 'timeout' }); },
        'error-callback': function (code) { send({ type: 'error', code: String(code || '') }); return true; }
      });
    } catch (error) {
      send({ type: 'unavailable' });
    }
  };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer onerror="send({ type: 'unavailable' })"></script>
</body>
</html>
`;
}
