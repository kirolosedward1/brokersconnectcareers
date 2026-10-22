'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PhoneFrame, Screenshot, stackedScreen } from '@/components/get-app/phone-frame';

export type Step = { key: string; title: string; body: string; src: string; alt: string };

/**
 * The five screens, each with a sentence on what the reader does there.
 *
 * Two shapes from one state. From `lg` the phone sticks to the start of the
 * row while the steps scroll past it on the other side, and the screen
 * cross-fades to whichever step is crossing the middle of the viewport (an
 * IntersectionObserver with a band of 20% in the middle as its root margin);
 * pressing a step scrolls it into that band and shows its screen at once.
 * Below `lg` it is a row of phones that snaps as it scrolls, the step under
 * each, with an arrow at either end and a dot per screen; here the observer
 * runs inside the scroller and the most visible phone is the one that counts.
 *
 * Both are in the DOM and CSS shows one, which is why the two observers never
 * disagree: an element with no box never intersects anything. The captures
 * in the hidden one are lazy, so they are not fetched either.
 */
export function Walkthrough({
  steps,
  labels,
  className,
}: {
  steps: Step[];
  labels: { list: string; prev: string; next: string };
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const slideRefs = useRef<(HTMLLIElement | null)[]>([]);
  const scroller = useRef<HTMLUListElement>(null);
  /** Until when the observers are ignored, after a press scrolls past other steps. */
  const lockedUntil = useRef(0);

  const smooth = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? ('auto' as const) : ('smooth' as const);

  // Desktop: the step crossing the middle of the viewport.
  useEffect(() => {
    const items = stepRefs.current.filter((item): item is HTMLLIElement => item !== null);
    if (items.length === 0 || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (performance.now() < lockedUntil.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: '-40% 0px -40% 0px' },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [steps.length]);

  // Phone and tablet: the slide most in view inside the scroller.
  useEffect(() => {
    const root = scroller.current;
    const items = slideRefs.current.filter((item): item is HTMLLIElement => item !== null);
    if (!root || items.length === 0 || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (performance.now() < lockedUntil.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: 0.6 },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [steps.length]);

  const go = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(steps.length - 1, index));
      setActive(next);
      lockedUntil.current = performance.now() + 700;
      const behavior = smooth();
      // Whichever of the two is laid out scrolls; the other has no box and ignores it.
      stepRefs.current[next]?.scrollIntoView({ block: 'center', behavior });
      slideRefs.current[next]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior });
    },
    [steps.length],
  );

  const sizes = '(min-width: 1024px) 17rem, 15rem';

  return (
    <div className={className}>
      {/* From lg: the phone stays, the steps pass. */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="mx-auto w-[clamp(13rem,36vh,17rem)]">
            <PhoneFrame>
              {steps.map((step, index) => (
                <Screenshot
                  key={step.key}
                  src={step.src}
                  alt={step.alt}
                  sizes={sizes}
                  hidden={index !== active}
                  className={stackedScreen(index === active)}
                />
              ))}
            </PhoneFrame>
          </div>
        </div>

        <ol className="space-y-1 py-[14vh]">
          {steps.map((step, index) => (
            <li
              key={step.key}
              data-index={index}
              ref={(element) => {
                stepRefs.current[index] = element;
              }}
            >
              <button
                type="button"
                aria-current={index === active ? 'true' : undefined}
                onClick={() => go(index)}
                className={cn(
                  'flex w-full gap-5 rounded-xl border-s-2 px-5 py-5 text-start transition-[background-color,border-color,opacity] duration-300 motion-reduce:transition-none',
                  index === active
                    ? 'border-primary bg-muted/60 opacity-100'
                    : 'border-transparent opacity-70 hover:bg-muted/40 hover:opacity-100',
                )}
              >
                <span className="numeral mt-1 text-xs font-semibold text-primary">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-semibold leading-snug">{step.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {/* Below lg: one row, scrolled. */}
      <div className="lg:hidden">
        <ul
          ref={scroller}
          aria-label={labels.list}
          className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6"
        >
          {steps.map((step, index) => (
            <li
              key={step.key}
              data-index={index}
              ref={(element) => {
                slideRefs.current[index] = element;
              }}
              className="w-[66vw] max-w-[15rem] shrink-0 snap-center sm:w-60"
            >
              <PhoneFrame>
                <Screenshot src={step.src} alt={step.alt} sizes={sizes} />
              </PhoneFrame>
              <p className="mt-4 font-semibold leading-snug">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-4">
          <button
            type="button"
            aria-label={labels.prev}
            disabled={active === 0}
            onClick={() => go(active - 1)}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card transition-colors hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="rtl-flip size-5" aria-hidden />
          </button>

          <div className="flex gap-1">
            {steps.map((step, index) => (
              <button
                key={step.key}
                type="button"
                aria-label={step.title}
                aria-pressed={index === active}
                onClick={() => go(index)}
                className="grid h-11 w-6 place-items-center"
              >
                <span
                  aria-hidden
                  className={cn(
                    'block h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none',
                    index === active ? 'w-5 bg-primary' : 'w-1.5 bg-border',
                  )}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-label={labels.next}
            disabled={active === steps.length - 1}
            onClick={() => go(active + 1)}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card transition-colors hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="rtl-flip size-5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
