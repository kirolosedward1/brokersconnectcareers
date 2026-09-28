'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { Field, Input } from '@/components/ui/field';
import { createClient } from '@/lib/supabase/client';
import { localeHref, type Locale } from '@/i18n/routing';
import { safeNext } from '@/lib/safe-next';

/**
 * A second factor: an authenticator app, through Supabase's TOTP.
 *
 * Three states, one component. Nothing enrolled: offer to set one up, show
 * the QR code and the secret, take the first code. Enrolled but this session
 * has not answered: take a code. Enrolled and answered: say so, and offer to
 * turn it off (which Supabase permits only from an aal2 session — a stolen
 * aal1 session cannot remove the factor that keeps it out).
 *
 * Optional for everyone and required for admins: the console sends an admin
 * here with `?mfa=required` until a factor exists, and with `?mfa=challenge`
 * until this session has used it (see requireAdmin). The database enforces
 * the second half on its own — is_admin() is false at aal1 for an admin with
 * a factor — so this page is where the console becomes usable again, not the
 * thing that keeps it closed.
 *
 * Every step runs in the browser against the person's own session, the way
 * the password change does, because the calls are Supabase's and the session
 * is the credential.
 */
export function MfaSettings({
  locale,
  enrolled,
  level,
  mode,
  afterVerify,
}: {
  locale: Locale;
  /** Whether a verified factor exists on the account. */
  enrolled: boolean;
  /** What this session has proved. */
  level: 'aal1' | 'aal2';
  /** Why the person is here, if the console sent them. */
  mode: 'required' | 'challenge' | null;
  /** Where to go once a code is accepted. Validated as an internal path. */
  afterVerify?: string | null;
}) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');

  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // A session that already holds a factor but has not used it goes straight
  // to the code field: the factor is on the account, and there is nothing to
  // scan again.
  useEffect(() => {
    if (!enrolled || level === 'aal2') return;
    let cancelled = false;
    createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => {
        if (cancelled) return;
        const totp = data?.totp?.find((factor) => factor.status === 'verified') ?? data?.totp?.[0];
        if (totp) setFactorId(totp.id);
      });
    return () => {
      cancelled = true;
    };
  }, [enrolled, level]);

  function land() {
    // Through a document navigation, so the server sees the upgraded
    // session; through safeNext, so the destination is one of ours.
    const target = safeNext(afterVerify) ?? '/dashboard/account';
    window.location.assign(localeHref(locale, target));
  }

  function beginEnrolment() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();

      // An abandoned attempt leaves an unverified factor behind, and Supabase
      // refuses a second one under the same name. Clear it first — found in
      // `all`: the `totp` list holds verified factors only, so looking there
      // found nothing, and one abandoned attempt blocked every later one.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const factor of existing?.all ?? []) {
        if (factor.factor_type === 'totp' && factor.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }

      const { data, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Brokers Connect',
      });
      if (enrolError || !data) {
        setError(tCommon('errorBody'));
        return;
      }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    });
  }

  function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s+/g, '');
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError(t('mfaCodeInvalid'));
      return;
    }
    setError(null);

    startTransition(async () => {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge) {
        setError(tCommon('errorBody'));
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) {
        setError(t('mfaCodeInvalid'));
        return;
      }
      setDone(true);
      land();
    });
  }

  function disable() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const failures: string[] = [];
      for (const factor of data?.totp ?? []) {
        const { error: unenrolError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (unenrolError) failures.push(factor.id);
      }
      if (failures.length) {
        setError(tCommon('errorBody'));
        return;
      }
      land();
    });
  }

  const banner =
    mode === 'required' ? t('mfaRequiredBanner') : mode === 'challenge' ? t('mfaChallengeBanner') : null;

  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-4" aria-hidden />
        {t('mfaTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('mfaBody')}</p>

      {banner ? (
        <p className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">{banner}</p>
      ) : null}

      {/* Enrolled and proven: the state most people will see once, then never think about. */}
      {enrolled && level === 'aal2' && !qr ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-success">
            <Check className="size-4" aria-hidden />
            {t('mfaEnabled')}
          </p>
          <Button type="button" variant="outline" onClick={disable} disabled={pending}>
            <ShieldOff aria-hidden />
            {pending ? tCommon('loading') : t('mfaDisable')}
          </Button>
        </div>
      ) : null}

      {/* Enrolled, not yet proven this session: the code, and nothing else. */}
      {enrolled && level === 'aal1' ? (
        <form onSubmit={onVerify} className="mt-5 space-y-4">
          <p className="text-sm">{t('mfaChallengeBody')}</p>
          <Field label={t('mfaCode')} htmlFor="mfa-code">
            <Input
              id="mfa-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              dir="ltr"
              className="numeral-field"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <SubmitButton disabled={pending || done}>
            {pending ? tCommon('loading') : t('mfaVerify')}
          </SubmitButton>
        </form>
      ) : null}

      {/* Nothing enrolled: offer, then scan, then the first code. */}
      {!enrolled ? (
        qr ? (
          <form onSubmit={onVerify} className="mt-5 space-y-4">
            <p className="text-sm">{t('mfaScan')}</p>
            <div className="flex flex-wrap items-start gap-5">
              {/* Supabase returns the QR as an SVG data URI; img-src allows data:. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="" width={176} height={176} className="rounded-lg border border-border bg-white p-2" />
              <div className="min-w-0 text-sm">
                <p className="text-muted-foreground">{t('mfaSecret')}</p>
                <code className="numeral mt-1 block break-all rounded-md bg-muted px-2 py-1 text-xs" dir="ltr">
                  {secret}
                </code>
              </div>
            </div>
            <Field label={t('mfaCode')} htmlFor="mfa-code">
              <Input
                id="mfa-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                dir="ltr"
                className="numeral-field"
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <SubmitButton disabled={pending || done}>
              {pending ? tCommon('loading') : t('mfaVerify')}
            </SubmitButton>
          </form>
        ) : (
          <div className="mt-5">
            {error ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="button" onClick={beginEnrolment} disabled={pending}>
              <ShieldCheck aria-hidden />
              {pending ? tCommon('loading') : t('mfaSetup')}
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}
