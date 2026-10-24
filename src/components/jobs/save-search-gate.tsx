'use client';

import { SaveSearch } from '@/components/jobs/save-search';
import { useSession } from '@/components/session/session-provider';

/**
 * Who may save a search, decided in the browser.
 *
 * The board is cached, so it cannot know. A visitor sees the control and is
 * sent to sign in. A candidate sees the form. An employer, an admin and an
 * account still in onboarding see nothing — a saved search is a candidate's
 * row. While the session is still loading, nothing is shown, so an employer
 * does not flash the visitor's control.
 */
export function SaveSearchGate({ defaultLabel }: { defaultLabel: string }) {
  const session = useSession();
  if (session.kind === 'pending') return null;
  if (session.kind === 'user') {
    if (!session.hasProfile || session.role !== 'candidate') return null;
    return <SaveSearch signedIn defaultLabel={defaultLabel} />;
  }
  return <SaveSearch signedIn={false} defaultLabel={defaultLabel} />;
}
