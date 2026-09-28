'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { requeueEmail } from '@/lib/actions/admin';

/**
 * Put one dead-lettered email back in the queue.
 *
 * Nothing is sent from this click. The row gets one more attempt and a fresh
 * retry window, and the next sweep — every ten minutes — sends it or records
 * why not. So the only thing this button can honestly report is that the row
 * left the dead-letter list, which the refresh shows by removing it.
 *
 * A row somebody else already requeued comes back as a failure rather than a
 * silent success; the refresh then shows the list as it now is.
 */
export function RequeueEmailButton({ emailId }: { emailId: string }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setFailed(false);
      const result = await requeueEmail({ emailId });
      if (!result.ok) setFailed(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={run}>
        {t('opsRetry')}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {tCommon('errorBody')}
        </span>
      ) : null}
    </div>
  );
}
