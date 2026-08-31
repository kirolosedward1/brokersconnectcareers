import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing, locales, activeLocales, ENGLISH_ENABLED } from '@/i18n/routing';
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

export async function middleware(request: NextRequest) {
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

  // updateSession never throws, but middleware runs on every request, so the
  // call site is belt-and-braces: an unexpected failure here must not turn the
  // whole site into a 500.
  let user = null;
  try {
    ({ user } = await updateSession(request, response));
  } catch (error) {
    console.warn(
      '[middleware] session refresh failed:',
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

export const config = {
  matcher: [
    // Everything except Next internals, the API surface, the OAuth callback,
    // and static files. /auth/* must not be locale-prefixed — Supabase redirects
    // to a fixed URL that is registered with the provider.
    '/((?!api|auth|_next|_vercel|.*\\..*).*)',
  ],
};
