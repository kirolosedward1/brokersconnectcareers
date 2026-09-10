import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing, locales, ENGLISH_ENABLED } from '@/i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';
import { safeNext } from '@/lib/safe-next';

const handleI18n = createIntlMiddleware(routing);

/**
 * Everything under these prefixes requires a signed-in user.
 *
 * Must cover every route group under app/[locale]/(app), plus /onboarding,
 * which lives outside it. A route inside (app) that is missing here is not
 * exposed — the (app) layout redirects an anonymous visitor too — but that
 * redirect cannot carry `next`, so somebody following a link into it is signed
 * in and then dropped on their dashboard instead of the page they asked for.
 * /notifications was in exactly that state, which is how a notification link
 * from an email lost its destination.
 *
 * The parity test in supabase/tests/auth.test.mjs reads the filesystem and
 * fails if a new group is added without being listed here. This is the second
 * time a hand-maintained list of (app) routes has drifted — the header
 * suppression list did it first — so the list now has something checking it.
 */
const PROTECTED = ['/dashboard', '/employer', '/admin', '/notifications', '/onboarding'];

/** Strips `/en` so route matching is written once, against the canonical path. */
function stripLocale(pathname: string): { locale: string; path: string } {
  for (const locale of locales) {
    if (pathname === `/${locale}`) return { locale, path: '/' };
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, path: pathname.slice(locale.length + 1) };
    }
  }
  return { locale: routing.defaultLocale, path: pathname };
}

function localized(locale: string, path: string): string {
  return locale === routing.defaultLocale ? path : `/${locale}${path}`;
}

/**
 * What to serve when the middleware itself has failed.
 *
 * Every page lives under app/[locale], so a bare NextResponse.next() would 404
 * the entire site. This reproduces by hand the one thing next-intl does that
 * the routes cannot live without — the rewrite from /jobs to /ar/jobs — using
 * nothing but the request, so it still works when the reason for failing was
 * next-intl itself.
 *
 * The result is a page rendered in the default locale with nobody signed in.
 * Degraded, but a site.
 */
function withoutMiddleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return NextResponse.next();
    }
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${routing.defaultLocale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url);
}

async function handle(request: NextRequest): Promise<NextResponse> {
  // A stray OAuth code, rescued.
  //
  // The provider returns the user to Supabase, which returns them to the
  // `redirect_to` the app asked for — /auth/callback. But when that URL is not
  // in Supabase's allow-list, Supabase silently falls back to the project's
  // Site URL, which is the site root, and the code arrives on a page that has
  // no idea what to do with it: `/?code=…`, rendered as an error.
  //
  // That is a dashboard misconfiguration and the real fix is to allow-list the
  // callback. But the symptom is a dead-end on the single most important
  // action in the product, so the code is forwarded to the route that can spend
  // it rather than wasted. Only from the site root, and only a real auth code —
  // deeper pages are left alone, and the callback itself is outside this
  // middleware's matcher, so this cannot loop.
  {
    const { path } = stripLocale(request.nextUrl.pathname);
    const params = request.nextUrl.searchParams;
    if (path === '/' && (params.has('code') || params.has('error'))) {
      return NextResponse.redirect(
        new URL(`/auth/callback${request.nextUrl.search}`, request.url),
      );
    }
  }

  // English is translated but unpublished. Send /en/* to the Arabic equivalent
  // rather than 404-ing it, and do it temporarily (307) so the URLs are not
  // written off by search engines while the language is merely paused.
  if (!ENGLISH_ENABLED) {
    const { pathname, search } = request.nextUrl;
    if (pathname === '/en' || pathname.startsWith('/en/')) {
      const target = pathname === '/en' ? '/' : pathname.slice(3);
      return NextResponse.redirect(new URL(`${target}${search}`, request.url), 307);
    }
  }

  const response = handleI18n(request);

  // A redirect from the i18n layer has nothing to authorise yet.
  if (response.headers.get('location')) return response;

  // updateSession guards its own failures, but a session that cannot be read is
  // still a better outcome than falling all the way through to the bare
  // fallback below and losing the locale rewrite with it.
  let user = null;
  try {
    ({ user } = await updateSession(request, response));
  } catch (error) {
    console.warn(
      '[middleware] session refresh failed, treating the request as anonymous:',
      error instanceof Error ? error.message : error,
    );
  }
  const { locale, path } = stripLocale(request.nextUrl.pathname);

  const needsAuth = PROTECTED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  if (needsAuth && !user) {
    const signIn = new URL(localized(locale, '/sign-in'), request.url);
    // The unprefixed path. next-intl's router adds the locale back on the way
    // in, so storing `/en/dashboard` here returns somebody to
    // `/en/en/dashboard` — latent while English is unpublished, and wrong the
    // day it is turned on.
    signIn.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  // A signed-in user with nothing left to do on /sign-in should not sit there.
  //
  // Honouring `next` rather than always landing on the dashboard: somebody who
  // followed "sign in to report this listing" from a job page, in a browser
  // that already had a session, was told to sign in and then dropped on their
  // dashboard with the listing forgotten. Validated, because it is a redirect
  // target read from a query string.
  if (user && (path === '/sign-in' || path === '/sign-up')) {
    const intended = safeNext(request.nextUrl.searchParams.get('next'));
    return NextResponse.redirect(
      new URL(localized(locale, intended ?? '/dashboard'), request.url),
    );
  }

  return response;
}

/**
 * Middleware runs in front of every request, so anything that escapes here is
 * not a broken page — it is a broken site, served as Vercel's
 * MIDDLEWARE_INVOCATION_FAILED with no way to tell which of the routes behind
 * it were actually fine. Nothing this file does is worth that: the locale
 * rewrite has a hand-rolled fallback, and auth failing closed only means a
 * protected route sends the visitor to sign in.
 *
 * The catch is deliberately total rather than targeted. A guard written against
 * the failures we predicted is exactly the guard that misses the one we did not.
 */
export async function middleware(request: NextRequest) {
  try {
    return await handle(request);
  } catch (error) {
    console.error(
      '[middleware] unhandled failure, serving the request without it:',
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return withoutMiddleware(request);
  }
}

export const config = {
  matcher: [
    // Everything except Next internals, the API surface, the OAuth callback,
    // and static files. /auth/* must not be locale-prefixed — Supabase redirects
    // to a fixed URL that is registered with the provider.
    '/((?!api|auth|_next|_vercel|.*\\..*).*)',
  ],
};
