'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
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
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => move('closed')}>
          {labels.close}
        </Button>
        {errorNote}
      </>
    );
  }

  if (status === 'draft' || status === 'rejected') {
    return (
      <>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => move('pending_review')}>
          {labels.submit}
        </Button>
        {errorNote}
      </>
    );
  }

  if (status === 'expired' || status === 'closed') {
    return (
      <>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => move('pending_review')}>
          {labels.reopen}
        </Button>
        {errorNote}
      </>
    );
  }

  return null;
}
