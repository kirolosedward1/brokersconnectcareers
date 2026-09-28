import { NextResponse, type NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import {
  asConfirmType,
  confirmDestination,
  isTokenHash,
  readRedirectTo,
  type ConfirmType,
} from '@/lib/auth/confirm-link';
import { landingAfterSignIn } from '@/lib/auth/landing';
import { defaultLocale, dirOf } from '@/lib/locale';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/server';

/**
 * Where the current auth emails land: a confirmation, a password reset, an
 * email change, an invitation.
 *
 * The links carry a token hash rather than a code (scripts/auth-templates.mjs),
 * which verifies wherever the link is opened. The code flow, still at
 * /auth/callback, needed the same browser that asked for the email — so an
 * address confirmed on the phone after signing up on a laptop failed, and so
 * would every link opened in the iOS app. The app opens this very URL as a
 * universal link and verifies the token itself; this is the website's half.
 *
 * GET only draws a button, and the POST it submits is what spends the link.
 * Mail scanners (Outlook's Safe Links and others) open every link in a message
 * before a person does, and a one-time token spent by a scanner is a link that
 * says "expired" to the one person it was for. A scanner fetches; it does not
 * press buttons.
 *
 * Outside the locale segment, like /auth/callback: the URL is written into
 * templates and cannot vary by language.
 */
export const dynamic = 'force-dynamic';

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
};

function linkFailed(origin: string) {
  return NextResponse.redirect(new URL('/sign-in?error=link_expired', origin), 303);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin, search } = request.nextUrl;
  const type = asConfirmType(searchParams.get('type'));
  const tokenHash = searchParams.get('token_hash');
  if (!type || !isTokenHash(tokenHash)) return linkFailed(origin);

  const next = confirmDestination(type, readRedirectTo(search), origin);
  const t = await getTranslations({ locale: defaultLocale, namespace: 'auth.confirm' });
  const titles: Record<ConfirmType, string> = {
    signup: t('titleEmail'),
    email: t('titleEmail'),
    recovery: t('titleRecovery'),
    email_change: t('titleEmailChange'),
    invite: t('titleInvite'),
    magiclink: t('titleMagiclink'),
  };

  return new NextResponse(
    page({
      title: titles[type],
      body: t('body'),
      action: t('continue'),
      why: t('why'),
      fields: { token_hash: tokenHash, type, next: next ?? '' },
    }),
    { headers: PAGE_HEADERS },
  );
}

export async function POST(request: NextRequest) {
  const { origin } = request.nextUrl;

  // Only the form above spends a link. A page elsewhere posting somebody
  // else's token here would sign the visitor into that account.
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });

  const form = await request.formData().catch(() => null);
  const type = asConfirmType(String(form?.get('type') ?? ''));
  const tokenHash = String(form?.get('token_hash') ?? '');
  const next = safeNext(String(form?.get('next') ?? '')) ?? null;
  if (!type || !isTokenHash(tokenHash)) return linkFailed(origin);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return linkFailed(origin);

  // A reset always goes to the form that sets the new password, and an email
  // change to where it asked or the account page; everything else lands the
  // way every other sign-in does, onboarding included.
  if (type === 'recovery') return NextResponse.redirect(new URL('/sign-in/new-password', origin), 303);
  if (type === 'email_change') return NextResponse.redirect(new URL(next ?? '/dashboard/account', origin), 303);
  return NextResponse.redirect(await landingAfterSignIn(supabase, origin, next), 303);
}

/**
 * The browser says where a form post came from: `Origin` on every POST from a
 * current browser, `Sec-Fetch-Site` beside it. Either one naming another site
 * is refused; a request with neither (an old browser) is let through, because
 * it can only have come from a link somebody followed.
 */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === request.nextUrl.origin;
  const site = request.headers.get('sec-fetch-site');
  return !site || site === 'same-origin';
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One card and one button, with no script: the site's colours in light and
 * dark, the system's Arabic face (the page loads nothing from anywhere).
 */
function page({
  title,
  body,
  action,
  why,
  fields,
}: {
  title: string;
  body: string;
  action: string;
  why: string;
  fields: Record<string, string>;
}): string {
  const lang = defaultLocale;
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join('');

  return `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<!-- The token is in the address: nothing this page loads may be told it. -->
<meta name="referrer" content="no-referrer">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #FDFDFF; --card: #FFFFFF; --fg: #111826; --muted: #626978; --border: #DADEE6; --primary: #2A4FF6; --primary-fg: #FAFCFF; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0B0F19; --card: #131824; --fg: #EFF2F7; --muted: #9298A5; --border: #282E3B; --primary: #6C97FF; --primary-fg: #040B22; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
         background: var(--bg); color: var(--fg); font: 17px/1.75 "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; }
  main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 28px 24px; text-align: center; }
  img { width: 56px; height: 56px; }
  h1 { font-size: 22px; line-height: 1.4; margin: 12px 0 4px; }
  p { margin: 0; color: var(--muted); }
  button { margin-top: 20px; width: 100%; min-height: 48px; border: 0; border-radius: 8px; background: var(--primary); color: var(--primary-fg);
           font: inherit; font-weight: 600; cursor: pointer; }
  small { display: block; margin-top: 14px; font-size: 13px; line-height: 1.6; color: var(--muted); }
</style>
</head>
<body>
<main>
  <img src="/brand/logo-mark.png" alt="" width="56" height="56">
  <h1>${escape(title)}</h1>
  <p>${escape(body)}</p>
  <form method="post" action="/auth/confirm">${hidden}<button type="submit">${escape(action)}</button></form>
  <small>${escape(why)}</small>
</main>
</body>
</html>
`;
}
