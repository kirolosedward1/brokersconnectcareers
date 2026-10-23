'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** How long each line stays before the next rises into its place. */
export const TRUST_LINE_MS = 3600;

/**
 * The hero's promises, one at a time: each rises into place as the one
 * before it has faded, every few seconds, round and round. Three short lines
 * where one stood, without three lines' height under the search.
 *
 * All the lines are laid out in the same cell, the ones not showing
 * invisible rather than absent, so the row is as tall as the tallest line
 * from the start and nothing under it moves when a longer line's turn comes.
 * A reader whose system asks for less motion sees them all, still, as a list;
 * so does a screen reader, which is not told about the rotation (the moving
 * copy is hidden from it, the whole list is not).
 *
 * The app's Home draws the same lines the same way
 * (mobile/src/components/home/trust-lines.tsx).
 */
export function TrustLines({ lines, className }: { lines: string[]; className?: string }) {
  const [showing, setShowing] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduceMotion(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  useEffect(() => {
    if (reduceMotion || lines.length < 2) return;
    const timer = window.setInterval(() => setShowing((at) => (at + 1) % lines.length), TRUST_LINE_MS);
    return () => window.clearInterval(timer);
  }, [reduceMotion, lines.length]);

  if (reduceMotion) {
    return (
      <ul className={cn('flex flex-col gap-1.5 text-sm text-white/65', className)}>
        {lines.map((line) => (
          <li key={line} className="inline-flex items-center gap-1.5">
            <Check className="size-4 shrink-0 text-emerald-400" aria-hidden />
            {line}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={cn('text-sm text-white/65', className)}>
      <ul className="sr-only">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div aria-hidden className="grid">
        {lines.map((line, index) => (
          <p
            key={line}
            className={cn(
              'col-start-1 row-start-1 inline-flex items-center gap-1.5',
              index === showing
                ? 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500'
                : 'invisible',
            )}
          >
            <Check className="size-4 shrink-0 text-emerald-400" aria-hidden />
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
