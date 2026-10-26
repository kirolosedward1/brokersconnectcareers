'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { withdrawApplication } from '@/lib/actions/applications';
import { reach } from '@/lib/reach';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * The action tells the truth about whether the withdrawal happened; this shows
 * it. Both halves are needed — the action used to return ok for a delete RLS
 * had filtered away, and this used to discard the answer either way, so a
 * withdrawal that did not happen looked exactly like one that did.
 *
 * Asked first, in the app's words (myApplications.withdrawTitle/Body): it
 * cannot be undone — the unique index refuses a second application — and a
 * button one stray click from that is one click too few.
 */
export function WithdrawButton({
  applicationId,
  label,
  title,
}: {
  applicationId: string;
  label: string;
  /** The listing's title, named in the question. */
  title: string;
}) {
  const tCommon = useTranslations('common');
  const t = useTranslations('myApplications');
  const [asking, setAsking] = useState(false);
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {/*
        A quiet link on the card, and red once the pointer is on it.

        The row is a date and this action. Filling it red made the card look
        decided before anyone had chosen; the question that follows is where
        the warning belongs, and the hover says the same thing on the way there.
      */}
      <Button
        variant="ghost"
        size="sm"
        className="h-auto shrink-0 px-0 py-0.5 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-destructive"
        disabled={pending}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>

      <Dialog open={asking} onClose={() => setAsking(false)} label={t('withdrawTitle', { title })} closeLabel={tCommon('close')}>
        <div className="space-y-4">
          <h2 className="pe-8 text-lg font-semibold">{t('withdrawTitle', { title })}</h2>
          <p className="text-sm text-muted-foreground">{t('withdrawBody')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setFailure(null);
                  const result = await reach(withdrawApplication(applicationId));
                  setAsking(false);
                  if (recoverSession(result)) return;
                  if (!result.ok) {
                    setFailure(result.error === 'unavailable' ? t('withdrawUnavailable') : tCommon('errorBody'));
                    return;
                  }
                  router.refresh();
                })
              }
            >
              {pending ? tCommon('loading') : label}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setAsking(false)} data-autofocus>
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </Dialog>

      {failure ? (
        <span role="alert" className="text-xs text-destructive">
          {failure}
        </span>
      ) : null}
    </span>
  );
}
