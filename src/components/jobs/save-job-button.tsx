'use client';

import { useState, useTransition } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSignInGate } from '@/components/auth/sign-in-gate';
import { toggleSavedJob } from '@/lib/actions/jobs';
import { reach } from '@/lib/reach';
import { useSessionRecovery } from '@/lib/session-expired';

export function SaveJobButton({
  jobId,
  jobSlug,
  initialSaved,
  canSave,
  labels,
}: {
  jobId: string;
  /**
   * Where a visitor comes back to. Pressing Save signed out opens the sign-in
   * dialog over the listing (sign-in-gate.tsx), and the save goes through
   * once they are in; a sign-up, or a one-tap provider, leaves the page and
   * returns here by this slug.
   */
  jobSlug: string;
  initialSaved: boolean;
  canSave: boolean;
  labels: { save: string; saved: string };
}) {
  const requireSignIn = useSignInGate();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function toggle() {
    // Optimistic: the toggle is trivially reversible, and waiting on a round
    // trip for a bookmark feels broken.
    const next = !saved;
    setSaved(next);

    startTransition(async () => {
      const result = await reach(toggleSavedJob(jobId));
      if (recoverSession(result)) return;
      if (!result.ok) setSaved(!next);
      else setSaved(result.data!.saved);
    });
  }

  function onClick() {
    if (canSave) {
      toggle();
      return;
    }
    void requireSignIn({ reason: 'save', next: `/jobs/${jobSlug}` }).then((signedIn) => {
      if (signedIn) toggle();
    });
  }

  return (
    <Button variant="outline" size="lg" onClick={onClick} disabled={pending} aria-pressed={saved}>
      {saved ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
      {saved ? labels.saved : labels.save}
    </Button>
  );
}
