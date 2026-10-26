'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { localeHref, type Locale } from '@/i18n/routing';
import { forgetDrafts } from '@/lib/form-draft';

/** This browser only, the same sign-out the header uses. */
export function AccountSignOut({ locale }: { locale: Locale }) {
  const t = useTranslations('nav');
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      const { createClient } = await import('@/lib/supabase/client');
      await createClient().auth.signOut({ scope: 'local' });
      forgetDrafts();
      window.location.assign(localeHref(locale, '/'));
    });
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="flex min-h-11 w-full items-center px-4 py-3 text-start text-sm font-medium hover:bg-muted/50 disabled:opacity-60"
    >
      {t('signOut')}
    </button>
  );
}
