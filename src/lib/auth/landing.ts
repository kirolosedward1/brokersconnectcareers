import 'server-only';
import { locales } from '@/lib/locale';
import { logFailure } from '@/lib/observe';
import { safeNext, stripLocalePrefix } from '@/lib/safe-next';
import type { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Where somebody goes the moment a sign-in link has given them a session —
 * shared by /auth/callback (the code flow: Google, and links minted before
 * /auth/confirm existed) and /auth/confirm (the token-hash links in the
 * current emails), so the two cannot disagree about who needs onboarding.
 *
 * `next` is the raw destination the link carried, validated here.
 */
export async function landingAfterSignIn(supabase: ServerClient, origin: string, next: string | null): Promise<URL> {
  // A user with no profile row has not been through onboarding yet.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    /*
      Unreadable is not "has not onboarded", and this is the sign-in path.

      The absence of this row is how the landing knows to send somebody to
      /onboarding, so a failed read used to send an established account
      through the sign-up form — where the duplicate key would refuse them and
      bounce them onward. `getViewer` carries a whole `profileUnreadable` flag
      because of exactly this confusion; the callback was never given the same
      distinction, on the one path every Google sign-in goes through.

      `maybeSingle()` reports no error for no row, so an error here is real.
      Signing in succeeded either way — the session is set — so the honest
      answer is to send them where they were going and let that page read the
      profile again and say something true about it. Falling through rather
      than returning: the redirect at the end of this function is already that
      answer.
    */
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      logFailure('auth', 'could not read the profile after sign-in', {
        code: profileError.code,
      });
    } else if (!profile) {
      /*
        Validated here, not only on the way out.

        This value used to be copied into the onboarding URL raw and checked
        again downstream with `startsWith('/')`, which `//evil.example`
        satisfies. That was survivable while the destination went through
        next-intl's router, which treats the string as a pathname; it stopped
        being survivable the moment the last hop became a real navigation.
      */
      const wanted = safeNext(next);

      /*
        The employer door has nowhere but `next` to carry the role across the
        provider round-trip, so it comes back as `/onboarding?role=employer`.
        Nesting that inside another /onboarding dropped the query — every
        company signing up with Google landed on onboarding with "consultant"
        pre-selected, which is the same bug the password form already fixed —
        and then sent them back through onboarding a second time on the way
        out. An onboarding href is the destination, not the passenger.
      */
      if (wanted && stripLocalePrefix(new URL(wanted, origin).pathname, locales) === '/onboarding') {
        return new URL(wanted, origin);
      }

      const target = new URL('/onboarding', origin);
      // `/` is the stand-in for "no preference", not a destination worth
      // carrying: passed through, it overrides the role-aware landing and
      // drops a new account on the marketing page instead of their own.
      if (wanted && wanted !== '/') target.searchParams.set('next', wanted);
      return target;
    }
  }

  // Only ever a path on this origin — an open redirect here would hand an
  // attacker a trusted-looking login link. Shared with the middleware and the
  // sign-in form so all three agree on what "internal" means; the rule once
  // written inline here missed backslashes and percent-encoded slashes.
  return new URL(safeNext(next) ?? '/', origin);
}
