'use client';

import { useLocale } from 'next-intl';
import { localeHref, locales, asLocale, type Locale } from '@/i18n/routing';
import { safeNext, stripLocalePrefix } from '@/lib/safe-next';

/**
 * What to do when a server action answers `unauthenticated`.
 *
 * Sixteen actions can return it — every one that begins by asking Supabase who
 * the caller is — and until this existed, not one caller handled it. The
 * result reached the same branch as a database error and rendered "something
 * went wrong, try again", which is advice that cannot work: the session is
 * gone, and the next attempt fails identically, and the one after that. The
 * person is left tapping a button that will never do anything, with no
 * indication that the fix is to sign in.
 *
 * Sessions do end. Supabase refresh tokens expire, a password change on
 * another device revokes them, and a tab left open overnight comes back to
 * one. The only honest response is to say so and carry them back here
 * afterwards.
 *
 * Returns true when it has taken over the navigation, so the caller stops.
 */
export function recoverExpiredSession(
  result: { ok: boolean; error?: string },
  locale: Locale,
): boolean {
  if (result.ok || result.error !== 'unauthenticated') return false;

  /*
    Where to come back to, minus the locale prefix that next-intl's router adds
    again on the way back — the trap stripLocalePrefix was written for. Read
    from the browser rather than passed in, because the page this happens on is
    never the one that knows it is about to happen.
  */
  const here = stripLocalePrefix(
    `${window.location.pathname}${window.location.search}`,
    locales,
  );

  /*
    Through safeNext even though this path came from the address bar rather
    than from a query parameter.

    Not ceremony. The query string on the current URL is as attacker-supplied
    as any other — a link can be sent with anything after the `?` — and it is
    about to be handed back to a redirect. One definition of "internal path",
    used everywhere, is the rule the auth suite enforces by reading the source;
    a second, informal one here is how that rule stops being true.
  */
  const back = safeNext(here) ?? '/';

  window.location.assign(
    localeHref(locale, `/sign-in?next=${encodeURIComponent(back)}&error=session_expired`),
  );
  return true;
}

/**
 * The same thing, without the locale to plumb through.
 *
 * Every caller is a client component inside the next-intl provider, and none
 * of them needed to know their own locale for any other reason.
 */
export function useSessionRecovery(): (result: { ok: boolean; error?: string }) => boolean {
  const locale = asLocale(useLocale());
  return (result) => recoverExpiredSession(result, locale);
}
