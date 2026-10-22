'use client';

import { createElement, useEffect, useRef } from 'react';

/**
 * Something that arrives as the reader reaches it: faded up 14px, once.
 *
 * Nothing on the site's other pages does this (globals.css, "Motion", says
 * why); this is the product page for a phone app, where a little arrival is
 * the convention, and it is kept to the places that say "there is more
 * below". The rules are in globals.css under `data-reveal`.
 *
 * Rendered visible. On mount, anything already on screen is left exactly as
 * it is, and only what is below the fold is set to wait — so there is no
 * flash on the first paint, nothing is hidden from a reader without
 * JavaScript, and under `prefers-reduced-motion` nothing moves at all.
 */
export function Reveal({
  as = 'div',
  delay = 0,
  className,
  children,
}: {
  as?: 'div' | 'li' | 'header';
  /** Milliseconds, for a row of cards arriving one after another. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const box = element.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;

    element.dataset.reveal = 'waiting';
    const observer = new IntersectionObserver(
      ([entry]) => {
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
