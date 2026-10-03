'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { localeHref, type Locale } from '@/i18n/routing';
import { deleteMyAccount } from '@/lib/actions/account';
import { reach } from '@/lib/reach';
import { Button } from '@/components/ui/button';

/**
 * The way out of onboarding, for somebody who signed up and changed their
 * mind: sign out, or delete the account.
 *
 * Every other page with these controls sits behind a finished profile — the
 * console sends an account without one back here — so the only way to delete
 * an account that never got past its email address was to agree to the Terms
 * first. The app's Account tab never had that problem; this is the website's
 * answer. An account with no profile owns nothing and has applied to nothing,
 * so deleting it (deleteMyAccount, as the settings page does) takes the
 * sign-in and the address, and nothing anybody else holds.
 *
 * Focus moves with the panel, as it does for a dialog: to Cancel when the
 * question opens — the choice that loses nothing — and back to the button
 * that asked when it closes; the delete button says it is busy rather than
 * going disabled, which would drop focus to the top of the page.
 */
export function LeaveOnboarding({ locale, signOutLabel }: { locale: Locale; signOutLabel: string }) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (opened.current) askRef.current?.focus();
    opened.current = confirming;
  }, [confirming]);

  function signOut() {
    startTransition(async () => {
      const { createClient } = await import('@/lib/supabase/client');
      await createClient().auth.signOut();
      // A document navigation, as the user menu does: who the server thinks
      // you are has just changed.
      window.location.assign(localeHref(locale, '/'));
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await reach(deleteMyAccount());
      if (!result.ok) {
        setError(t('leaveFailed'));
        return;
      }
      window.location.assign(localeHref(locale, '/'));
    });
  }

  return (
    <section className="mt-10 border-t border-border pt-6 text-sm" aria-labelledby="leave-onboarding">
      <h2 id="leave-onboarding" className="font-medium">
        {t('leaveQuestion')}
      </h2>
      {confirming ? (
        <div className="mt-3 space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p role="alert">{t('leaveConfirm')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={pending ? undefined : remove}
              aria-disabled={pending}
              className="aria-disabled:opacity-50"
            >
              {pending ? tCommon('loading') : t('leaveConfirmCta')}
            </Button>
            <Button ref={cancelRef} type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={signOut} disabled={pending}>
            {signOutLabel}
          </Button>
          <Button
            ref={askRef}
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirming(true)}
            disabled={pending}
          >
            {t('leaveDelete')}
          </Button>
        </div>
      )}
    </section>
  );
}
