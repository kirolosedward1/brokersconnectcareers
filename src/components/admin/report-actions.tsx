'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { actOnReportedJob } from '@/lib/actions/admin';

/**
 * The two things a reviewer can decide about a reported listing.
 *
 * This replaces a lone "resolve" button, which marked the complaint handled
 * and left the listing untouched — the only outcome that screen could produce
 * was closing the report, so the queue emptied whether or not anything was
 * wrong. Both verbs here clear every open report on the listing at once,
 * because reports are one per person and five of them are one problem.
 *
 * Taking down asks for a reason before it will fire: the employer is emailed
 * the decision, and "rejected" with no explanation is the version of that email
 * that generates a support thread.
 */
export function ReportActions({ jobId, jobIsLive }: { jobId: string; jobIsLive: boolean }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(takeDown: boolean) {
    startTransition(async () => {
      setFailed(false);
      const result = await actOnReportedJob({ jobId, takeDown, note: note || undefined });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {jobIsLive ? (
        confirming ? (
          <>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('rejectReason')}
              className="h-9 w-56"
              maxLength={500}
              autoFocus
            />
            <Button variant="destructive" size="sm" disabled={pending} onClick={() => run(true)}>
              {t('takeDown')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {tCommon('cancel')}
            </Button>
          </>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
            {t('takeDown')}
          </Button>
        )
      ) : null}

      {confirming ? null : (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(false)}>
          {t('dismissReports')}
        </Button>
      )}

      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {tCommon('errorBody')}
        </span>
      ) : null}
    </div>
  );
}
