'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { createClient } from '@/lib/supabase/client';
import { localeHref, type Locale } from '@/i18n/routing';

/**
 * Set the new password, on the session the recovery link just created.
 *
 * The confirm field is here for the same reason it is on sign-up: this is the
 * one moment where a typo locks somebody out of the account they are in the
 * middle of recovering, and the mistake is invisible until the next sign-in.
 *
 * On success it goes to the dashboard rather than back to sign-in. The session
 * is already live — sending somebody who has just proved they own the address
 * to a login form would be asking them to use the password they set four
 * seconds ago.
 */
export function NewPasswordForm({ locale }: { locale: Locale }) {
  const t = useTranslations('auth');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('passwordConfirm') ?? '');

    if (password.length < 8) {
      setError(tValidation('passwordShort'));
      return;
    }
    if (password !== confirm) {
      setError(tValidation('passwordMismatch'));
      return;
    }

    startTransition(async () => {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError(
          /session|jwt|expired/i.test(updateError.message)
            ? t('linkExpired')
            : tCommon('errorBody'),
        );
        return;
      }
      setDone(true);
      /*
        Same as sign-in: the session has just changed, so the server has to
        be asked again from scratch rather than through a router push racing
        a refresh. /dashboard redirects by role, and a swallowed redirect
        leaves a blank page.
      */
      window.location.assign(localeHref(locale, '/dashboard'));
    });
  }

  if (done) {
    return (
      <p className="inline-flex items-center gap-2 rounded-xl border border-success/30 bg-success-muted p-4 text-sm">
        <Check className="size-4 shrink-0 text-success" aria-hidden />
        {t('passwordUpdated')}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={t('password')} htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          dir="ltr"
        />
      </Field>

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

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? tCommon('loading') : t('resetPassword')}
      </Button>
    </form>
  );
}
