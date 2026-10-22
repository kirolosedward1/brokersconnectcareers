'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import { APP_STORE_URL } from '@/lib/app-links';
import { LogoMark } from '@/components/logo';

/**
 * On a phone, once the hero has scrolled away: a slim bar along the bottom
 * with the mark, the name and a short "get" button to the App Store. It
 * leaves while the closing band — which has the full buttons — is on
 * screen, and it never exists from `lg`.
 *
 * Marked `data-apply-bar` so the footer reserves the height under it, the
 * way it does for a listing's apply bar (globals.css), and padded by the
 * phone's safe area at the bottom.
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
  /** The button's word. */
  label: string;
  /** What the button does, in full, for a screen reader. */
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
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur transition-transform duration-300 ease-out motion-reduce:transition-none lg:hidden',
        'pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2',
        shown ? 'translate-y-0' : 'translate-y-full',
      )}
    >
      <div className="shell flex items-center gap-3">
        <LogoMark className="size-9" />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        <a
          href={APP_STORE_URL ?? '#'}
          target={APP_STORE_URL ? '_blank' : undefined}
          rel="noopener"
          aria-label={ariaLabel}
          tabIndex={shown ? 0 : -1}
          onClick={() => track('app_store_click', { location: 'sticky' })}
          className="inline-flex h-11 shrink-0 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-primary)] transition-colors hover:bg-primary-hover"
        >
          {label}
        </a>
      </div>
    </div>
  );
}
