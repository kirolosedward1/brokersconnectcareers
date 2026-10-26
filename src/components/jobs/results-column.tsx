'use client';

import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/components/session/session-provider';
import { hidesAppPromo, persistAppView } from '@/lib/app-view';
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
 *
 * `?app=1` hides it too, and a session cookie keeps it hidden after the
 * query is gone. The cached HTML still contains the card; this drops it
 * before paint once the flag is known.
 */
export function ResultsColumn({ promo, children }: { promo: ReactNode; children: ReactNode }) {
  const hide = useHideAppPromo();

  return (
    <div
      className={cn(
        'min-w-0',
        !hide && 'lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6 xl:gap-8',
      )}
    >
      <div className="min-w-0">{children}</div>
      {hide ? null : (
        <aside className="sticky top-[96px] hidden w-[300px] self-start lg:block">{promo}</aside>
      )}
    </div>
  );
}

/**
 * Drops its children once the reader is known to have the app, or to be
 * inside a session that asked not to see the card.
 *
 * Used for the inline card. The side column is ResultsColumn's own
 * decision, for the same reason: the cached page cannot know.
 */
export function AppPromoGate({ children }: { children: ReactNode }) {
  const hide = useHideAppPromo();
  if (hide) return null;
  return children;
}

function useHideAppPromo(): boolean {
  const session = useSession();
  const [inApp, setInApp] = useState(false);

  useLayoutEffect(() => {
    const read = () => {
      persistAppView(
        { search: window.location.search, protocol: window.location.protocol },
        (value) => {
          document.cookie = value;
        },
      );
      setInApp(hidesAppPromo({ search: window.location.search, cookie: document.cookie }));
    };
    read();
    window.addEventListener('bc-app-view', read);
    return () => window.removeEventListener('bc-app-view', read);
  }, []);

  return inApp || (session.kind === 'user' && session.hasApp);
}
