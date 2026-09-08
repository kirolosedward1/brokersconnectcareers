'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, KeyRound, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { createClient } from '@/lib/supabase/client';

/**
 * Change your password, change your email.
 *
 * Both were missing entirely: the only way to alter either was to ask somebody
 * with database access. Both run in the browser against the caller's own
 * session rather than through a server action, because Supabase's own
 * `updateUser` is the thing that enforces the rules here — password length,
 * the double-confirmation on an email change — and a server action wrapping it
 * would only be re-implementing them one layer further from the source.
 *
 * The email change is a two-sided confirmation on Supabase's side: nothing
 * moves until the new address is confirmed, which is what stops a borrowed
 * session from quietly walking off with the account. The copy says so, because
 * an unexplained "we sent you something" reads as a failure.
 */
export function CredentialsSettings({
  email,
  hasPassword,
}: {
  email: string;
  /** False for an account created through Google, which has none to change. */
  hasPassword: boolean;
}) {
  const t = useTranslations('account');
  const tAuth = useTranslations('auth');
  const tValidation = useTranslations('validation');
  const tCommon = useTranslations('common');

  const [passwordDone, setPasswordDone] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, startPassword] = useTransition();

  const [emailPending, setEmailPending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, startEmail] = useTransition();

  function onPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('newPassword') ?? '');
    const confirm = String(data.get('newPasswordConfirm') ?? '');

    setPasswordDone(false);
    setPasswordError(null);

    if (password.length < 8) {
      setPasswordError(tValidation('passwordShort'));
      return;
    }
    if (password !== confirm) {
      setPasswordError(tValidation('passwordMismatch'));
      return;
    }

    startPassword(async () => {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        setPasswordError(tCommon('errorBody'));
        return;
      }
      form.reset();
      setPasswordDone(true);
    });
  }

  function onEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = String(new FormData(event.currentTarget).get('newEmail') ?? '').trim();

    setEmailPending(false);
    setEmailError(null);
    if (!next || next === email) return;

    startEmail(async () => {
      const { error } = await createClient().auth.updateUser({ email: next });
      if (error) {
        setEmailError(
          /already registered|already been registered/i.test(error.message)
            ? tAuth('errEmailTaken')
            : tCommon('errorBody'),
        );
        return;
      }
      setEmailPending(true);
    });
  }

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{t('passwordTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasPassword ? t('passwordBody') : t('oauthOnly')}
        </p>

        {hasPassword ? (
          <form onSubmit={onPassword} className="mt-5 space-y-4">
            <Field label={t('newPassword')} htmlFor="newPassword">
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                dir="ltr"
              />
            </Field>

            <Field label={tAuth('passwordConfirm')} htmlFor="newPasswordConfirm">
              <Input
                id="newPasswordConfirm"
                name="newPasswordConfirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                dir="ltr"
              />
            </Field>

            {passwordError ? (
              <p role="alert" className="text-sm text-destructive">
                {passwordError}
              </p>
            ) : null}

            {passwordDone ? (
              <p className="inline-flex items-center gap-2 text-sm font-medium text-success">
                <Check className="size-4" aria-hidden />
                {t('passwordSaved')}
              </p>
            ) : null}

            <Button type="submit" disabled={savingPassword}>
              <KeyRound aria-hidden />
              {savingPassword ? tCommon('loading') : tCommon('save')}
            </Button>
          </form>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{t('emailTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('emailBody')}</p>

        <form onSubmit={onEmail} className="mt-5 space-y-4">
          <Field label={t('newEmail')} htmlFor="newEmail">
            <Input
              id="newEmail"
              name="newEmail"
              type="email"
              required
              defaultValue={email}
              autoComplete="email"
              dir="ltr"
            />
          </Field>

          {emailError ? (
            <p role="alert" className="text-sm text-destructive">
              {emailError}
            </p>
          ) : null}

          {emailPending ? (
            <p className="rounded-xl border border-success/30 bg-success-muted p-3 text-sm">
              {t('emailPending')}
            </p>
          ) : null}

          <Button type="submit" disabled={savingEmail}>
            <Mail aria-hidden />
            {savingEmail ? tCommon('loading') : tCommon('save')}
          </Button>
        </form>
      </section>
    </>
  );
}
