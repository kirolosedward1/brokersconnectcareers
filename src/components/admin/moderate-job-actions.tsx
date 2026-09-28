'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Star, StarOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { moderateJob, setJobFeatured } from '@/lib/actions/admin';
import { reach } from '@/lib/reach';

export function ModerateJobActions({
  jobId,
  isFeatured,
  showFeature,
}: {
  jobId: string;
  isFeatured: boolean;
  showFeature: boolean;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await reach(fn());
      if (!result.ok) {
        // Named, never echoed: `result.error` was printed as it stood, which
        // put a Postgres constraint name under the reviewer's button.
        setError(
          result.error === 'post_cap'
            ? t('postCapBlocked')
            : result.error === 'no_credits'
              ? t('noCreditsBlocked')
              : result.error === 'stale'
                ? t('staleListing')
                : tCommon('errorBody'),
        );
        // The queue has moved on; show it as it is.
        if (result.error === 'stale') router.refresh();
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="success"
        size="sm"
        disabled={pending}
        onClick={() => run(() => moderateJob({ jobId, approve: true }))}
      >
        {t('approve')}
      </Button>

      {rejecting ? (
        <>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('rejectReason')}
            size="sm"
            className="w-56"
            maxLength={500}
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => run(() => moderateJob({ jobId, approve: false, note }))}
          >
            {t('reject')}
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}>
          {t('reject')}
        </Button>
      )}

      {showFeature ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setJobFeatured({ jobId, featured: !isFeatured }))}
        >
          {isFeatured ? <StarOff /> : <Star />}
          {isFeatured ? t('unfeature') : t('feature')}
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
