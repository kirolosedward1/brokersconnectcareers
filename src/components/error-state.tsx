'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

/**
 * The body of every error boundary that still has translations available.
 *
 * It deliberately does not claim the data is empty. A page that cannot reach
 * the database says so; it does not quietly render "no jobs found" and let an
 * employer conclude the board is dead.
 *
 * The digest stays on screen. It is the only handle anyone has when matching
 * what a reader saw against a line in the platform logs.
 */
export function ErrorState({
  error,
  reset,
  scope,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    console.error(`[${scope}] render failed:`, error);
  }, [error, scope]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">{t('error')}</h1>
      <p className="mt-2 text-muted-foreground">{t('errorBody')}</p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>{t('retry')}</Button>
        <Button asChild variant="outline">
          <Link href="/">{t('goHome')}</Link>
        </Button>
      </div>

      {error.digest ? (
        <p className="mt-8 text-xs text-muted-foreground">
          {t('errorReference')} <span className="numeral font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
