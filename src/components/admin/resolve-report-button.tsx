'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { resolveReport } from '@/lib/actions/admin';

/**
 * A moderation control that says nothing when it fails is worse than one that
 * is not there: the reviewer moves on believing the queue is shorter than it
 * is. resolveReport now refuses an id that matches nothing, and this shows it.
 */
export function ResolveReportButton({ reportId, label }: { reportId: string; label: string }) {
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            const result = await resolveReport(reportId);
            if (!result.ok) {
              setFailed(true);
              return;
            }
            router.refresh();
          })
        }
      >
        {label}
      </Button>

      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {tCommon('errorBody')}
        </span>
      ) : null}
    </span>
  );
}
