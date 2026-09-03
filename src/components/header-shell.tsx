'use client';

import { useEffect, useState } from 'react';
import { usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** The pages whose hero the header sits on top of. */
const OVER_HERO = ['/', '/employers'];

/**
 * The pages that render no site header at all.
 *
 * A nav bar full of links is an invitation to wander off mid-task, which is
 * the last thing a half-finished sign-up needs. AuthShell puts a logo and one
 * way back where the header would have been.
 */
const NO_HEADER = ['/sign-in', '/sign-up'];

/**
 * The header's chrome.
 *
 * On the two landing pages it lifts off the page and sits on the film: no
 * background, no border, white type. Everywhere else it stays the solid
 * sticky bar, because a transparent header over a white listings page is just
 * a header you cannot see the edge of.
 *
 * It solidifies as soon as you scroll. Transparent is right while the hero is
 * behind it and wrong the moment a job card is, and the switch has to happen
 * before the type lands on white — hence a threshold of a few dozen pixels
 * rather than the height of the hero.
 *
 * A passive scroll listener comparing one number. An IntersectionObserver on
 * a sentinel would avoid the per-scroll work, but it needs an out-of-flow
 * element and a positioned body to hang it on, and that is a lot of apparatus
 * for a boolean. This is the smaller thing that does the same job.
 *
 * Fixed rather than sticky while over the hero, so the film starts at the top
 * of the viewport instead of below a reserved 4rem strip.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const overHero = OVER_HERO.includes(pathname);
  const hidden = NO_HEADER.includes(pathname);

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!overHero) return;

    const update = () => setScrolled(window.scrollY > 24);
    update(); // a reload partway down the page must not start transparent
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [overHero]);

  const floating = overHero && !scrolled;

  if (hidden) return null;

  return (
    <header
      // Read by the nav items, which need a light hover on film and the normal
      // muted one everywhere else.
      data-over-hero={floating ? 'true' : undefined}
      className={cn(
        'group/header z-40 transition-colors duration-300',
        overHero ? 'fixed inset-x-0 top-0' : 'sticky top-0',
        floating
          ? 'border-b border-transparent bg-transparent text-white'
          : 'border-b border-border/70 bg-background/80 shadow-xs backdrop-blur-xl',
      )}
    >
      {children}
    </header>
  );
}
