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

export function AuthForm({ mode, locale }: { mode: 'sign-in' | 'sign-up'; locale: Locale }) {
  const t = useTranslations('auth');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? undefined;

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
      router.replace(next ?? '/onboarding', { locale });
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
      router.replace(next ?? '/onboarding', { locale });
      router.refresh();
    });
  }

  function signInWithGoogle() {
    startTransition(async () => {
      const callback = new URL('/auth/callback', window.location.origin);
      if (next) callback.searchParams.set('next', next);

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
