'use client';

import { createElement, useEffect, useRef } from 'react';

/**
 * Something that arrives as the reader reaches it: faded up 16px, once.
 *
 * Nothing on the site's other pages does this (globals.css, "Motion", says
 * why); this is the product page for a phone app, where a little arrival is
 * the convention. The rules are in globals.css under `data-reveal`; `delay`
 * staggers a row.
 *
 * Rendered visible. On mount, anything already on screen is left exactly as
 * it is, and only what is below the fold is set to wait — so there is no
 * flash on the first paint, nothing is hidden from a reader without
 * JavaScript, and under `prefers-reduced-motion` nothing moves at all. The
 * observer's first report says which is which, so nothing here measures
 * the layout itself (a hundred of these reading their own box, each after
 * the last one wrote, is a hundred forced reflows).
 */
export function Reveal({
  as = 'div',
  delay = 0,
  className,
  children,
}: {
  as?: 'div' | 'li' | 'header' | 'figure' | 'article';
  /** Milliseconds, for a row arriving one after another. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let first = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (first) {
          first = false;
          // Its box, as the observer measured it: anything in the viewport at
          // all stays, whatever the margin below says.
          const box = entry.boundingClientRect;
          if (box.top < window.innerHeight && box.bottom > 0) {
            observer.disconnect();
            return;
          }
          element.dataset.reveal = 'waiting';
          return;
        }
        if (!entry.isIntersecting) return;
        element.dataset.reveal = 'in';
        observer.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return createElement(
    as,
    { ref, className, style: delay ? { transitionDelay: `${delay}ms` } : undefined },
    children,
  );
}
