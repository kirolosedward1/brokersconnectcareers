'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Gift } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { claimMonthlyFreePost } from '@/lib/actions/company';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * Verified companies get one free single post per calendar month, permanently.
 * It keeps supply alive and gives the sales conversation an opening.
 */
export function ClaimFreePostButton({ claimed }: { claimed: boolean }) {
  const t = useTranslations('employer');
  const router = useRouter();
  const [done, setDone] = useState(claimed);
  const [refused, setRefused] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  if (done) {
    return <p className="text-sm text-muted-foreground">{t('freePostClaimed')}</p>;
  }

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setRefused(false);
            const result = await claimMonthlyFreePost();
            if (recoverSession(result)) return;

            /*
              `ok` is not the answer here.

              claim_monthly_free_post() returns a boolean: false when the
              company is not verified, and false when this month's grant
              already exists. Both come back as a successful call, and this
              read only `result.ok` — so the button said "you have your free
              post for this month" on a month where nothing had been granted,
              which is the one claim a credit button must never make wrongly.
            */
            if (result.ok && result.data?.claimed) {
              setDone(true);
              router.refresh();
              return;
            }

            setRefused(true);
            // Whatever the reason, the server knows more than this component
            // does — so re-read rather than guess which of the two it was.
            router.refresh();
          })
        }
      >
        <Gift />
        {t('freePostClaim')}
      </Button>

      {refused ? (
        <p role="alert" className="text-sm text-destructive">
          {t('freePostRefused')}
        </p>
      ) : null}
    </div>
  );
}
