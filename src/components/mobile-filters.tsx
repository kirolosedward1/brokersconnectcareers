'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlidersHorizontal, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { useModalLayer } from '@/components/ui/dialog';
import { formatNumber } from '@/lib/utils';

/**
 * The board's filters on a phone: a sheet from the bottom edge.
 *
 * This was a `<details>` that opened in place, which put the whole rail —
 * six groups and every district in the country — between the reader and the
 * results they were filtering. Ticking a box changed a list that was four
 * screens further down, so there was no way to see what a filter had done
 * without scrolling past all of them and back.
 *
 * A sheet keeps the results where they were. Filters still apply as they are
 * ticked, the way they do on a desktop, so the footer has nothing to submit:
 * its button says how many listings the current choice leaves and closes the
 * sheet onto them, and "clear" is a link to the unfiltered board.
 *
 * The thumb's side of the screen, sized to the dynamic viewport so the
 * browser's own bars cannot cover the footer, and padded for the home
 * indicator.
 */
export function MobileFilters({
  children,
  count,
  total,
  locale,
  clearHref = '/jobs',
}: {
  children: React.ReactNode;
  /** How many filters are on. */
  count: number;
  /** How many listings they leave. */
  total: number;
  locale: string;
  /** Where "clear" goes — the same list with nothing applied. */
  clearHref?: '/jobs' | '/agents';
}) {
  const t = useTranslations('jobs');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const sheetRef = useRef<HTMLDivElement>(null);

  useModalLayer(open, close, sheetRef);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-primary/40"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        {t('filters')}
        {count > 0 ? (
          <span className="numeral rounded bg-primary px-1.5 text-xs text-primary-foreground">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('filters')}
            className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-xl border-t border-border bg-card shadow-lg motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border ps-4 pe-1.5">
              <p className="text-sm font-semibold">{t('filters')}</p>
              <button
                type="button"
                onClick={close}
                aria-label={tCommon('close')}
                className="grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>

            <div className="flex items-center gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {count > 0 ? (
                <Button asChild variant="ghost">
                  <Link href={clearHref} scroll={false} onClick={close}>
                    {t('clearFilters')}
                  </Link>
                </Button>
              ) : null}
              <Button type="button" className="flex-1" onClick={close}>
                {t.rich('showResultsCount', {
                  count: formatNumber(total, locale),
                  v: (chunks) => <span className="numeral">{chunks}</span>,
                })}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
