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
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {/*
        Red, because withdrawing is the irreversible one.

        It sat in the same grey as every other line on the card, which made the
        action that takes an application back — and it cannot be put back, the
        unique index refuses a second one — the least conspicuous thing there.
        The employer console already settled this for "close the listing": a
        colour each, and each one means something rather than varying for
        variety.
      */}
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive-muted hover:text-destructive"
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
                  setFailed(false);
                  const result = await reach(withdrawApplication(applicationId));
                  setAsking(false);
                  if (recoverSession(result)) return;
                  if (!result.ok) {
                    setFailed(true);
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

      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {tCommon('errorBody')}
        </span>
      ) : null}
    </span>
  );
}
