'use client';

import type { ReactNode } from 'react';
import { useSession } from '@/components/session/session-provider';
import { cn } from '@/lib/utils';

/**
 * The results, and — from 1024px — a 300px column on the left of them.
 *
 * The page is RTL, so the first column of a grid sits on the right.
 * The listings are the first child and the card the second, which puts
 * the card on the left. The filter rail stays where it was, on the right.
 *
 * A signed-in reader who has registered the app gets neither column
 * nor card: the HTML is the anonymous page, and /api/chrome says
 * whether this browser's session has an active push device.
 */
export function ResultsColumn({ promo, children }: { promo: ReactNode; children: ReactNode }) {
  const session = useSession();
  const showRail = !(session.kind === 'user' && session.hasApp);

  return (
    <div
      className={cn(
        'min-w-0',
        showRail && 'lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6 xl:gap-8',
      )}
    >
      <div className="min-w-0">{children}</div>
      {showRail ? (
        <aside className="sticky top-[96px] hidden w-[300px] self-start lg:block">{promo}</aside>
      ) : null}
    </div>
  );
}

/**
 * Drops its children once the session is known to have the app.
 *
 * Used for the inline card. The side column is ResultsColumn's own
 * decision, for the same reason: the cached page cannot know.
 */
export function AppPromoGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.kind === 'user' && session.hasApp) return null;
  return children;
}
