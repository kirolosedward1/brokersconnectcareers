'use client';

import { useLocale, useTranslations } from 'next-intl';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DraftState } from '@/lib/use-form-draft';

/**
 * Says that a form was filled from a draft, or that one is waiting.
 *
 * Never silent. A form that opened already filled in, with no word why, reads
 * as somebody else's work or a bug — and a person who wanted to start again
 * would have to empty every field by hand. So a restored draft says when it
 * was typed and offers to start over, and a held-back one (typed over a
 * version that has since changed) asks before it touches anything.
 *
 * Renders nothing when there is no draft either way.
 */
export function DraftNotice({ draft, className }: { draft: DraftState; className?: string }) {
  const t = useTranslations('drafts');
  const locale = useLocale();
  const v = (chunks: React.ReactNode) => <span className="numeral">{chunks}</span>;

  if (draft.offeredAt !== null) {
    return (
      <div
        role="status"
        className={cn('rounded-xl border border-warning/40 bg-warning-muted p-4 text-sm', className)}
      >
        <p className="flex items-start gap-2 leading-relaxed">
          <History className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t.rich('offered', { when: formatDateTime(new Date(draft.offeredAt), locale), v })}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={draft.accept}>
            {t('restore')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={draft.discard}>
            {t('discard')}
          </Button>
        </div>
      </div>
    );
  }

  if (draft.restoredAt !== null) {
    return (
      <div
        role="status"
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm',
          className,
        )}
      >
        <p className="flex items-start gap-2 leading-relaxed text-muted-foreground">
          <History className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t.rich('restored', { when: formatDateTime(new Date(draft.restoredAt), locale), v })}</span>
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={draft.discard}>
          {t('startOver')}
        </Button>
      </div>
    );
  }

  return null;
}
