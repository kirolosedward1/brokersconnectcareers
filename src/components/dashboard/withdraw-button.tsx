'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { withdrawApplication } from '@/lib/actions/applications';

/**
 * The action tells the truth about whether the withdrawal happened; this shows
 * it. Both halves are needed — the action used to return ok for a delete RLS
 * had filtered away, and this used to discard the answer either way, so a
 * withdrawal that did not happen looked exactly like one that did.
 */
export function WithdrawButton({
  applicationId,
  label,
}: {
  applicationId: string;
  label: string;
}) {
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            const result = await withdrawApplication(applicationId);
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
