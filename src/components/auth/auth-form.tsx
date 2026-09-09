'use client';

import { useState, useTransition } from 'react';
import { Building2, MailCheck, RefreshCw, UserRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { safeNext } from '@/lib/safe-next';

/**
 * Google's mark, inline.
 *
 * Four paths rather than an <img>: the CSP blocks off-origin images, and a
 * button that silently loses its logo on a stricter network is worse than one
 * that never had it. Google's brand guidelines require the coloured mark on a
 * white button, which is what `variant="outline"` already gives.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4 shrink-0" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Supabase speaks English, and this page does not.
 *
 * Every auth failure was reaching the reader as whatever string GoTrue
 * returned — "Invalid login credentials" on an otherwise Arabic sign-in form.
 * The same class of bug as an untranslated status enum, and worse placed: it
 * lands on the one screen where somebody is already unsure whether they did
 * something wrong.
 *
 * Matched on substrings rather than codes because GoTrue's error codes are not
 * stable across versions and its messages have been. Anything unrecognised
 * falls through to the generic line rather than to English — a reader is
 * better served by "something went wrong" in their own language than by a
 * precise sentence in one they may not read.
 */
type Mapped = { namespace: 'auth' | 'validation'; key: string };

/**
 * GoTrue's own error codes, which are stable across versions and do not change
 * with the server's language. Matched first.
 *
 * The message regexes below were the only thing here, and they are English
 * prose from another team's codebase — a rewording upstream silently turns a
 * precise message into "something went wrong". Live testing found one already:
 * a rejected domain answers `Email address "x@y" is invalid`, which matches
 * neither /unable to validate email/ nor /invalid format/, so a mistyped
 * address produced the generic error instead of "check your email address".
 */
const AUTH_ERROR_CODES: Record<string, Mapped> = {
  invalid_credentials: { namespace: 'auth', key: 'errBadCredentials' },
  user_already_exists: { namespace: 'auth', key: 'errEmailTaken' },
  email_exists: { namespace: 'auth', key: 'errEmailTaken' },
  email_not_confirmed: { namespace: 'auth', key: 'errEmailUnconfirmed' },
  over_request_rate_limit: { namespace: 'auth', key: 'errTooMany' },
  over_email_send_rate_limit: { namespace: 'auth', key: 'errTooMany' },
  email_address_invalid: { namespace: 'validation', key: 'invalidEmail' },
  validation_failed: { namespace: 'validation', key: 'invalidEmail' },
  weak_password: { namespace: 'validation', key: 'passwordShort' },
};

/** Kept as the fallback, for older servers and errors that carry no code. */
const AUTH_ERRORS: { match: RegExp; namespace: 'auth' | 'validation'; key: string }[] = [
  { match: /invalid login credentials/i, namespace: 'auth', key: 'errBadCredentials' },
  { match: /already registered|already been registered|user already exists/i, namespace: 'auth', key: 'errEmailTaken' },
  { match: /email not confirmed|confirm your email/i, namespace: 'auth', key: 'errEmailUnconfirmed' },
  { match: /for security purposes|rate limit|too many requests/i, namespace: 'auth', key: 'errTooMany' },
  { match: /unable to validate email|invalid format|address .* is invalid/i, namespace: 'validation', key: 'invalidEmail' },
  { match: /password should be at least/i, namespace: 'validation', key: 'passwordShort' },
];

export function AuthForm({
  mode,
  locale,
  audience,
  googleEnabled = false,
}: {
  mode: 'sign-in' | 'sign-up';
  locale: Locale;
  /**
   * Which door this was. Passed to onboarding so the role arrives
   * pre-selected — never used to decide anything for an existing account,
   * whose role is already stored.
   */
  audience?: 'candidate' | 'employer';
  /**
   * Whether the auth server will actually accept a Google sign-in. Asked of
   * GoTrue by the page that renders this, not assumed — the button spent its
   * whole life returning "provider is not enabled".
   */
  googleEnabled?: boolean;
}) {
  const t = useTranslations('auth');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');

  /**
   * GoTrue's English, turned back into the language of the page.
   *
   * Takes the whole error rather than its message, so the stable `code` can be
   * read first and the prose only consulted when there is none.
   */
  const readable = (error: { message: string; code?: string } | string) => {
    const message = typeof error === 'string' ? error : error.message;
    const code = typeof error === 'string' ? undefined : error.code;

    const known =
      (code ? AUTH_ERROR_CODES[code] : undefined) ??
      AUTH_ERRORS.find((entry) => entry.match.test(message));

    if (!known) {
      // Unmapped, so the user gets the generic line — but the detail stays in
      // the console, because the alternative is an error nobody can diagnose.
      console.warn('[auth] unmapped error', { code, message });
      return tCommon('errorBody');
    }
    return known.namespace === 'auth' ? t(known.key) : tValidation(known.key);
  };

  const router = useRouter();
  const searchParams = useSearchParams();
  // Validated, not taken on trust: this decides a navigation and arrives in a
  // query string anybody can craft. An unusable value falls back to onboarding
  // rather than being handed to the router to turn into a 404.
  const next = safeNext(searchParams.get('next')) ?? undefined;

  // Onboarding is where a new account chooses its role; if the door already
  // implied one, hand it over. An existing account skips onboarding entirely,
  // so this can never override a stored role.
  /**
   * An object, not a string with a `?` in it.
   *
   * next-intl's router takes the string form as a whole pathname, so
   * `/onboarding?role=employer` arrived as a path with no query and the role
   * was silently dropped — every company that came through the employer door
   * landed on onboarding with "consultant" pre-selected. The href for the
   * OAuth callback still has to be a string, hence the two shapes.
   */
  const onboarding = audience
    ? ({ pathname: '/onboarding', query: { role: audience } } as const)
    : ({ pathname: '/onboarding' } as const);
  const onboardingHref = audience ? `/onboarding?role=${audience}` : '/onboarding';

  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  /** Kept so the confirmation can be sent again without retyping it. */
  const [pendingEmail, setPendingEmail] = useState('');
  const [resent, setResent] = useState<'sent' | 'wait' | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    if (password.length < 8) {
      setError(tValidation('passwordShort'));
      return;
    }

    // Sign-up only. Asking somebody to type a password they already have twice
    // is friction with nothing behind it — there is no typo to catch, because
    // the wrong one simply fails to sign them in.
    if (mode === 'sign-up' && password !== String(form.get('passwordConfirm') ?? '')) {
      setError(tValidation('passwordMismatch'));
      return;
    }

    startTransition(async () => {
      const supabase = createClient();

      if (mode === 'sign-up') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (signUpError) {
          setError(readable(signUpError));
          return;
        }
        // With email confirmation enabled there is no session yet.
        if (!data.session) {
          setPendingEmail(email);
          setCheckEmail(true);
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(readable(signInError));
          return;
        }
      }

      // Onboarding decides for itself whether there is anything left to ask.
      router.replace(next ?? onboarding, { locale });
      router.refresh();
    });
  }

  /**
   * Shared demo accounts, seeded by scripts/seed-demo.mjs.
   *
   * The password is in the client bundle, which is fine and unavoidable: a
   * button that logs anyone in without asking for credentials has, by
   * definition, published them. What keeps this safe is what the accounts can
   * reach — RLS confines them to their own rows, and a job they post lands in
   * pending_review like anyone else's rather than going live.
   */
  const DEMO_PASSWORD = 'password123';
  const DEMO_EMAILS = {
    candidate: 'candidate1@demo.test',
    employer: 'employer1@demo.test',
  } as const;

  function signInAsDemo(kind: keyof typeof DEMO_EMAILS) {
    setError(null);
    startTransition(async () => {
      const { error: demoError } = await createClient().auth.signInWithPassword({
        email: DEMO_EMAILS[kind],
        password: DEMO_PASSWORD,
      });
      if (demoError) {
        setError(demoError.message);
        return;
      }
      router.replace(next ?? onboarding, { locale });
      router.refresh();
    });
  }

  function signInWithGoogle() {
    startTransition(async () => {
      const callback = new URL('/auth/callback', window.location.origin);
      if (next) callback.searchParams.set('next', next);
      else if (audience) callback.searchParams.set('next', onboardingHref);

      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback.toString() },
      });
      if (oauthError) setError(oauthError.message);
    });
  }

  /**
   * The end of sign-up, and until now a dead end.
   *
   * This project requires email confirmation and sends it through whatever
   * mail is configured, which today means it can be slow or filtered. A screen
   * that says "check your email" and offers nothing else strands the one
   * person it is talking to — they cannot sign in, cannot try again, and have
   * no way to ask for another. So: name the spam folder, and offer to send it
   * again. Supabase rate-limits the resend itself, which is the answer the
   * button gives when it is pressed too often.
   */
  if (checkEmail) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-success/30 bg-success-muted p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MailCheck className="size-4 shrink-0" aria-hidden />
            {t('checkEmailTitle')}
          </p>
          <p className="mt-2 text-sm">{t('checkEmail')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('checkEmailSpam')}</p>
        </div>

        {resent === 'sent' ? (
          <p className="text-sm font-medium text-success">{t('resendSent')}</p>
        ) : resent === 'wait' ? (
          <p role="alert" className="text-sm text-destructive">
            {t('resendWait')}
          </p>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={() => {
            setResent(null);
            startTransition(async () => {
              const { error: resendError } = await createClient().auth.resend({
                type: 'signup',
                email: pendingEmail,
                options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
              });
              setResent(resendError ? 'wait' : 'sent');
            });
          }}
        >
          <RefreshCw aria-hidden />
          {pending ? tCommon('loading') : t('resendConfirmation')}
        </Button>

        <p className="text-center text-sm">
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            {t('backToSignIn')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {googleEnabled ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            size="lg"
            onClick={signInWithGoogle}
            disabled={pending}
          >
            <GoogleMark />
            {t('continueWithGoogle')}
          </Button>

          {/* The separator belongs to the button. Without one there is nothing
              above the form for "or" to separate it from. */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t('or')}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('email')} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            inputMode="email"
          />
        </Field>

        <Field label={t('password')} htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            dir="ltr"
          />
        </Field>

        {/* Sign-in only, and under the field it rescues. The copy for this has
            been in the catalogue since long before the screen it points at
            existed. */}
        {mode === 'sign-in' ? (
          <p className="-mt-1 text-end text-sm">
            <Link href="/sign-in/forgot" className="font-medium text-primary hover:underline">
              {t('forgotPassword')}
            </Link>
          </p>
        ) : null}

        {mode === 'sign-up' ? (
          <Field label={t('passwordConfirm')} htmlFor="passwordConfirm">
            <Input
              id="passwordConfirm"
              name="passwordConfirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              dir="ltr"
            />
          </Field>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? tCommon('loading') : mode === 'sign-up' ? t('signUp') : t('signIn')}
        </Button>
      </form>

      {/* Sign-in only. Offering a demo account on the sign-up screen would be
          arguing against the thing that screen exists to do. */}
      {mode === 'sign-in' ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4">
          <p className="text-center text-xs font-medium text-muted-foreground">{t('demoTitle')}</p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="w-full bg-card"
              onClick={() => signInAsDemo('candidate')}
              disabled={pending}
            >
              <UserRound aria-hidden />
              {t('demoCandidate')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full bg-card"
              onClick={() => signInAsDemo('employer')}
              disabled={pending}
            >
              <Building2 aria-hidden />
              {t('demoEmployer')}
            </Button>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">{t('demoHint')}</p>
        </div>
      ) : null}
    </div>
  );
}
