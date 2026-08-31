'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Star, StarOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { moderateJob, setJobFeatured } from '@/lib/actions/admin';

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
  const router = useRouter();

  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error === 'post_cap' ? t('postCapBlocked') : result.error ?? null);
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
            className="h-8 w-56"
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
