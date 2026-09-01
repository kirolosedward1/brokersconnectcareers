import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing, locales, ENGLISH_ENABLED } from '@/i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

const handleI18n = createIntlMiddleware(routing);

/** Everything under these prefixes requires a signed-in user. */
const PROTECTED = ['/dashboard', '/employer', '/admin', '/onboarding'];

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
    signIn.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  // A signed-in user with nothing left to do on /sign-in should not sit there.
  if (user && (path === '/sign-in' || path === '/sign-up')) {
    return NextResponse.redirect(new URL(localized(locale, '/dashboard'), request.url));
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
