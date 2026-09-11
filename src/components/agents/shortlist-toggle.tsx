'use client';

import { useState, useTransition } from 'react';
import { UserRoundPlus, UserRoundCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toggleSavedAgent } from '@/lib/actions/talent-pool';
import { useSessionRecovery } from '@/lib/session-expired';
import { cn } from '@/lib/utils';

/**
 * Keeping a consultant on the company's shortlist.
 *
 * A person rather than a bookmark. The board already spends the bookmark glyph
 * on saved listings, and a product where the same mark means "a role I kept"
 * on one page and "a person we kept" on another has a mark that means neither.
 * This one is a person with a plus, and a person with a tick.
 *
 * Two shapes, for the same reason saving a job has two. On a directory card
 * this is a second action beside a card whose primary action is "open this",
 * so it is an icon with an accessible name and nothing that competes with the
 * consultant's name. On the profile itself it is one of two or three things
 * you can do, and deserves a labelled button beside them.
 *
 * Failure shows as the control going back, not as a message. It can fail
 * because the shortlist is full, or because the card is no longer open to this
 * company — and the second is a fact about the consultant's own privacy
 * settings, which an employer is not owed an explanation of.
 */
function useShortlist(agentId: string, initialSaved: boolean, onRemoved?: () => void) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function toggle() {
    // Optimistic, like every other bookmark here: reversing costs one click,
    // and waiting on a round trip to acknowledge it reads as broken.
    const next = !saved;
    setSaved(next);

    startTransition(async () => {
      const result = await toggleSavedAgent(agentId);
      if (recoverSession(result)) return;
      if (!result.ok) {
        setSaved(!next);
        return;
      }
      setSaved(result.data!.saved);
      // A list that holds this row needs telling, because the row cannot
      // remove itself and a server re-render does not arrive in time to.
      if (!result.data!.saved) onRemoved?.();
    });
  }

  return { saved, pending, toggle };
}

/**
 * The directory card's version.
 *
 * The card wraps its title in a stretched link covering the whole card, so
 * this has to sit above it — `relative z-10` — or the click would open the
 * profile instead of shortlisting from the list.
 */
export function ShortlistToggle({
  agentId,
  initialSaved,
  labels,
  className,
  onRemoved,
}: {
  agentId: string;
  initialSaved: boolean;
  labels: { add: string; remove: string };
  className?: string;
  /** For a list that has to drop the row — see ShortlistList. */
  onRemoved?: () => void;
}) {
  const { saved, pending, toggle } = useShortlist(agentId, initialSaved, onRemoved);

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? labels.remove : labels.add}
      title={saved ? labels.remove : labels.add}
      className={cn(
        'relative z-10 grid size-9 shrink-0 place-items-center rounded-lg',
        'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50',
        saved && 'text-primary hover:text-primary',
        className,
      )}
    >
      {saved ? (
        <UserRoundCheck className="size-5" aria-hidden />
      ) : (
        <UserRoundPlus className="size-5" aria-hidden />
      )}
    </button>
  );
}

/** The profile page's version, beside Contact and Download CV. */
export function ShortlistButton({
  agentId,
  initialSaved,
  labels,
}: {
  agentId: string;
  initialSaved: boolean;
  labels: { add: string; remove: string };
}) {
  const { saved, pending, toggle } = useShortlist(agentId, initialSaved);

  return (
    <Button
      type="button"
      variant={saved ? 'secondary' : 'outline'}
      size="lg"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
    >
      {saved ? <UserRoundCheck /> : <UserRoundPlus />}
      {saved ? labels.remove : labels.add}
    </Button>
  );
}
