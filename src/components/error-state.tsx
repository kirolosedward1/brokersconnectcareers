'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

/**
 * The body of every error boundary that still has translations available.
 *
 * Presented as a dialog over whatever rendered, rather than as a page of its
 * own. The difference is what the reader is told has happened: a full-page
 * error reads as "you have arrived somewhere", and somebody who was halfway
 * through a job application concluded they had been thrown out of it and
 * started again. A panel over the top says the thing they were doing is still
 * there and something on top of it went wrong — which is the truth, and it is
 * why Retry is the first button.
 *
 * `alertdialog` rather than `dialog`: this is not a question, it is an
 * interruption, and the distinction is the one screen readers announce.
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
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    console.error(`[${scope}] render failed:`, error);
  }, [error, scope]);

  useEffect(() => {
    // Focus lands on the way out of this, not somewhere behind it.
    retryRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-state-title"
        aria-describedby="error-state-body"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-lg"
      >
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" aria-hidden />
        </span>

        <h1 id="error-state-title" className="mt-4 text-xl font-semibold">
          {t('error')}
        </h1>
        <p id="error-state-body" className="mt-2 text-muted-foreground">
          {t('errorBody')}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button ref={retryRef} onClick={reset}>
            {t('retry')}
          </Button>
          <Button asChild variant="outline">
            <Link href="/">{t('goHome')}</Link>
          </Button>
        </div>

        {error.digest ? (
          <p className="mt-6 text-xs text-muted-foreground">
            {t('errorReference')} <span className="numeral font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
