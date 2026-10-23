'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import { APP_STORE_URL } from '@/lib/app-links';
import { LogoMark } from '@/components/logo';

/**
 * On a phone, once the hero has scrolled away: a small floating bar near
 * the foot of the screen with the mark, the name and a "get the app" button
 * to the App Store. It leaves while the closing band — which has the full
 * buttons — is on screen, and it never exists from `lg`.
 *
 * Floating rather than edge to edge, with a gap all round, so it reads as
 * an offer over the page rather than as a second toolbar under Safari's.
 * Marked `data-apply-bar` so the footer reserves the height under it, the
 * way it does for a listing's apply bar (globals.css).
 */
export function StickyDownloadBar({
  heroId,
  finalId,
  name,
  label,
  ariaLabel,
}: {
  /** The hero's id: the bar appears once it has gone. */
  heroId: string;
  /** The closing band's id: the bar leaves while it is in view. */
  finalId: string;
  name: string;
  /** The button's words. */
  label: string;
  /** What the button does, in full, for a screen reader; it starts with `label`. */
  ariaLabel: string;
}) {
  const [heroGone, setHeroGone] = useState(false);
  const [finalHere, setFinalHere] = useState(false);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const hero = document.getElementById(heroId);
    const final = document.getElementById(finalId);
    const observers: IntersectionObserver[] = [];
    if (hero) {
      const observer = new IntersectionObserver(([entry]) => setHeroGone(!entry.isIntersecting), { threshold: 0 });
      observer.observe(hero);
      observers.push(observer);
    }
    if (final) {
      const observer = new IntersectionObserver(([entry]) => setFinalHere(entry.isIntersecting), { threshold: 0.2 });
      observer.observe(final);
      observers.push(observer);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [heroId, finalId]);

  const shown = heroGone && !finalHere;

  return (
    <div
      data-apply-bar
      aria-hidden={!shown}
      className={cn(
        'fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none lg:hidden',
        shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[calc(100%+1.5rem)] opacity-0',
      )}
    >
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-background/95 p-2 ps-3 shadow-lg backdrop-blur">
        <LogoMark className="size-8" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
        <a
          href={APP_STORE_URL ?? '#'}
          target={APP_STORE_URL ? '_blank' : undefined}
          rel="noopener"
          aria-label={ariaLabel}
          tabIndex={shown ? 0 : -1}
          onClick={() => track('app_store_click', { location: 'sticky' })}
          className="inline-flex h-10 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          {label}
        </a>
      </div>
    </div>
  );
}
