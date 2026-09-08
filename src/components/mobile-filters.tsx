'use client';

import { useTranslations } from 'next-intl';
import { SlidersHorizontal } from 'lucide-react';

/**
 * The same filter panel, behind a button, below lg.
 *
 * A filter rail is the right shape beside a list and the wrong shape on top of
 * one: the consultant directory put fifteen controls between the heading and
 * the first result on a phone, so the page opened on a form rather than on the
 * thing it lists. A disclosure keeps the filters one tap away and the results
 * where somebody arrived to find them.
 *
 * Still a <details>, so it opens and closes with no JavaScript at all.
 */
export function MobileFilters({ children, count }: { children: React.ReactNode; count: number }) {
  const t = useTranslations('jobs');

  return (
    <details className="group rounded-xl border border-border bg-card lg:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium">
        <SlidersHorizontal className="size-4" aria-hidden />
        {t('filters')}
        {count > 0 ? (
          <span className="numeral rounded bg-primary px-1.5 text-xs text-primary-foreground">
            {count}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
