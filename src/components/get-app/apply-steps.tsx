'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Applying, in three steps that light up one after another as the section
 * comes into view, ending on the sent state. Under reduced motion, or with
 * no observer, all three are lit from the start.
 */
export function ApplySteps({
  steps,
  className,
}: {
  /** In order: open the listing, tap apply, sent. */
  steps: readonly [string, string, string];
  className?: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const [lit, setLit] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLit(3);
      return;
    }
    const timers: number[] = [];
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        [1, 2, 3].forEach((step, index) => {
          timers.push(window.setTimeout(() => setLit(step), 400 + index * 700));
        });
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <ol ref={ref} className={cn('flex flex-col gap-3 sm:flex-row sm:items-stretch', className)} aria-live="polite">
      {steps.map((step, index) => {
        const on = lit > index;
        const last = index === steps.length - 1;
        return (
          <li key={step} className="flex items-center gap-3 sm:flex-1">
            <div
              className={cn(
                'flex min-h-16 flex-1 items-center justify-center gap-3 rounded-2xl border px-3.5 py-3 transition-[border-color,background-color,color] duration-300 motion-reduce:transition-none lg:justify-start',
                on
                  ? last
                    ? 'border-success bg-success-muted text-foreground'
                    : 'border-primary/50 bg-primary/5'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors duration-300',
                  on ? (last ? 'bg-success text-success-foreground' : 'bg-primary text-primary-foreground') : 'bg-muted text-muted-foreground',
                )}
              >
                {on && last ? <Check className="size-4" aria-hidden /> : <span className="numeral">{index + 1}</span>}
              </span>
              <span className="whitespace-nowrap font-semibold">{step}</span>
            </div>
            {last ? null : (
              <ArrowRight
                className={cn('rtl-flip hidden size-5 shrink-0 sm:block transition-colors duration-300', on ? 'text-primary' : 'text-border')}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
