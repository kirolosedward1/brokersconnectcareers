'use client';

import { useState, useTransition } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { toggleSavedJob } from '@/lib/actions/jobs';

export function SaveJobButton({
  jobId,
  initialSaved,
  canSave,
  labels,
}: {
  jobId: string;
  initialSaved: boolean;
  canSave: boolean;
  labels: { save: string; saved: string };
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!canSave) {
      router.push('/sign-in');
      return;
    }

    // Optimistic: the toggle is trivially reversible, and waiting on a round
    // trip for a bookmark feels broken.
    const next = !saved;
    setSaved(next);

    startTransition(async () => {
      const result = await toggleSavedJob(jobId);
      if (!result.ok) setSaved(!next);
      else setSaved(result.data!.saved);
    });
  }

  return (
    <Button variant="outline" size="lg" onClick={onClick} disabled={pending} aria-pressed={saved}>
      {saved ? <BookmarkCheck /> : <Bookmark />}
      {saved ? labels.saved : labels.save}
    </Button>
  );
}
