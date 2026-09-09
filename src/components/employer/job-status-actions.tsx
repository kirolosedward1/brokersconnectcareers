'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Archive, RotateCcw, SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { transitionJob } from '@/lib/actions/employer-jobs';
import type { JobStatus } from '@/lib/supabase/database.types';

/**
 * Only the transitions an employer may actually make. Publishing is absent by
 * design — it is a moderation action, refused in the database.
 */
export function JobStatusActions({
  jobId,
  status,
  labels,
}: {
  jobId: string;
  status: JobStatus;
  labels: { close: string; reopen: string; submit: string };
}) {
  const t = useTranslations('employer');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(next: 'draft' | 'pending_review' | 'closed') {
    startTransition(async () => {
      const result = await transitionJob({ jobId, status: next });
      if (!result.ok) {
        setError(result.error === 'post_cap' ? t('postCapBlocked') : result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  const errorNote = error ? (
    <p role="alert" className="mt-2 w-full text-sm text-destructive">
      {error}
    </p>
  ) : null;

  if (status === 'active') {
    return (
      <>
        {/* Red, because this is the one that ends the listing. It sat in the
            same grey as "edit", which made the irreversible action the least
            conspicuous thing in the row. */}
        <Button
          variant="ghost"
          className="text-destructive hover:bg-destructive-muted"
          disabled={pending}
          onClick={() => move('closed')}
        >
          <Archive aria-hidden />
          {labels.close}
        </Button>
        {errorNote}
      </>
    );
  }

  if (status === 'draft' || status === 'rejected') {
    return (
      <>
        {/* Forward and positive — the same blue as the applicants link, since
            both are "go on then". */}
        <Button
          variant="secondary"
          className="text-primary"
          disabled={pending}
          onClick={() => move('pending_review')}
        >
          <SendHorizontal className="rtl-flip" aria-hidden />
          {labels.submit}
        </Button>
        {errorNote}
      </>
    );
  }

  if (status === 'expired' || status === 'closed') {
    return (
      <>
        {/* Green: this one brings a dead listing back. */}
        <Button
          variant="secondary"
          className="text-success"
          disabled={pending}
          onClick={() => move('pending_review')}
        >
          <RotateCcw aria-hidden />
          {labels.reopen}
        </Button>
        {errorNote}
      </>
    );
  }

  return null;
}
