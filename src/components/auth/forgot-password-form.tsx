'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Mail } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { createClient } from '@/lib/supabase/client';

/**
 * Ask for a reset link.
 *
 * The confirmation is deliberately vague — "if that email is registered" —
 * because a form that says "no account with that email" is an oracle: anybody
 * can walk a list of addresses through it and learn which ones are consultants
 * looking for work. So the same message shows either way, and any failure from
 * Supabase is swallowed for the same reason.
 *
 * The link lands on /auth/callback, which is already the registered redirect
 * and already exchanges a code for a session, then forwards to the one screen
 * that exists to set a password.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (!email) return;

    startTransition(async () => {
      await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/sign-in/new-password`,
      });
      // Shown whether or not that address exists. See above.
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-success/30 bg-success-muted p-4 text-sm">
          {t('resetSent')}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">{t('backToSignIn')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={t('email')} htmlFor="email">
        <Input id="email" name="email" type="email" required autoComplete="email" dir="ltr" />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        <Mail aria-hidden />
        {t('sendResetLink')}
      </Button>

      <p className="text-center text-sm">
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          {t('backToSignIn')}
        </Link>
      </p>
    </form>
  );
}
