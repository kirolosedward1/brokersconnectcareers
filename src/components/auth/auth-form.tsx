'use client';

import { useState, useTransition } from 'react';
import { Building2, UserRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

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

export function AuthForm({
  mode,
  locale,
  audience,
}: {
  mode: 'sign-in' | 'sign-up';
  locale: Locale;
  /**
   * Which door this was. Passed to onboarding so the role arrives
   * pre-selected — never used to decide anything for an existing account,
   * whose role is already stored.
   */
  audience?: 'candidate' | 'employer';
}) {
  const t = useTranslations('auth');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? undefined;

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
          setError(signUpError.message);
          return;
        }
        // With email confirmation enabled there is no session yet.
        if (!data.session) {
          setCheckEmail(true);
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
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

  if (checkEmail) {
    return (
      <p className="rounded-lg border border-success/30 bg-success-muted p-4 text-sm">
        {t('checkEmail')}
      </p>
    );
  }

  return (
    <div className="space-y-5">
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

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('or')}
        <span className="h-px flex-1 bg-border" />
      </div>

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
              size="sm"
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
              size="sm"
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
