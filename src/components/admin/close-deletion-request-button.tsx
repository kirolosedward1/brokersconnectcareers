'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { closeDeletionRequest } from '@/lib/actions/admin';

/**
 * An owner's deletion request, marked dealt with. Nothing is deleted by this
 * click — the company's fate and the account are handled first, on purpose —
 * so what it can honestly report is that the request left the list, which the
 * refresh shows by removing it.
 */
export function CloseDeletionRequestButton({ requestId }: { requestId: string }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setFailed(false);
      const result = await closeDeletionRequest({ requestId });
      if (!result.ok) setFailed(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={run}>
        {t('deletionRequestClose')}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {tCommon('errorBody')}
        </span>
      ) : null}
    </div>
  );
}
