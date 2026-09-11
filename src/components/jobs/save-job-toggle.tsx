'use client';

import { useState, useTransition } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { toggleSavedJob } from '@/lib/actions/jobs';
import { cn } from '@/lib/utils';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * Saving a listing from the card, without opening it.
 *
 * The bookmark existed only on the detail page, which made saving cost a
 * navigation each way: open the listing, save, go back, lose your place in the
 * list. That is the wrong shape for what saving is *for* — skimming a board and
 * putting three roles aside to read properly tonight.
 *
 * It is deliberately not the same control as the detail page's. There, saving
 * is one of two things you can do and deserves a labelled button beside Apply;
 * here it is a second action on a card whose primary action is "open this", so
 * it is an icon with an accessible name and nothing that competes with the job
 * title.
 *
 * The card wraps its title in a stretched link covering the whole card, so this
 * has to sit above it — `relative z-10` — or the click would open the listing
 * instead of saving it.
 */
export function SaveJobToggle({
  jobId,
  initialSaved,
  labels,
  className,
}: {
  jobId: string;
  initialSaved: boolean;
  labels: { save: string; remove: string };
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onClick() {
    // Optimistic, like the detail-page button: a bookmark that waits on a round
    // trip reads as broken, and the reversal below costs one click.
    const next = !saved;
    setSaved(next);

    startTransition(async () => {
      const result = await toggleSavedJob(jobId);
      if (recoverSession(result)) return;
      if (!result.ok) setSaved(!next);
      else setSaved(result.data!.saved);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? labels.remove : labels.save}
      title={saved ? labels.remove : labels.save}
      className={cn(
        'relative z-10 -mt-1 -me-1 grid size-9 shrink-0 place-items-center rounded-lg',
        'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50',
        saved && 'text-primary hover:text-primary',
        className,
      )}
    >
      {saved ? (
        <BookmarkCheck className="size-5" aria-hidden />
      ) : (
        <Bookmark className="size-5" aria-hidden />
      )}
    </button>
  );
}
