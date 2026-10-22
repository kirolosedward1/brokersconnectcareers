'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import { PhoneFrame, Screenshot, stackedScreen } from '@/components/get-app/phone-frame';

export type TourScreen = { key: string; title: string; body: string; src: string; alt: string };

/**
 * The five screens in one place.
 *
 * From `lg`: one phone, and beside it a list of tabs — number, name, one
 * line — in the tabs pattern (`tablist`, `tab`, `tabpanel`, roving focus,
 * the arrow keys, Home and End; left and right read the page's direction).
 * Choosing a tab cross-fades the phone's screen. The tour advances on its
 * own every five seconds until the reader touches it, and not while the
 * pointer is over it, and never under reduced motion.
 *
 * Below `lg`: a row that snaps as it scrolls, one phone a slide with its
 * caption under it, dots below, an arrow at either end. Both are in the
 * DOM and CSS shows one; an element with no box never intersects anything,
 * so the two observers never disagree.
 */
export function ScreenTour({
  screens,
  labels,
  className,
}: {
  screens: TourScreen[];
  labels: { list: string; prev: string; next: string };
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const idBase = useId();
  const touched = useRef(false);
  const hovering = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const slideRefs = useRef<(HTMLLIElement | null)[]>([]);
  const scroller = useRef<HTMLUListElement>(null);
  const lockedUntil = useRef(0);

  const choose = useCallback(
    (index: number, byUser: boolean) => {
      const next = (index + screens.length) % screens.length;
      setActive(next);
      if (byUser) {
        touched.current = true;
        track('app_tour_tab', { tab: screens[next].key });
      }
    },
    [screens],
  );

  // Advancing on its own, until somebody takes over.
  useEffect(() => {
    if (screens.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      if (touched.current || hovering.current || document.hidden) return;
      setActive((index) => (index + 1) % screens.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [screens.length]);

  // Below lg: the slide most in view inside the scroller.
  useEffect(() => {
    const root = scroller.current;
    const items = slideRefs.current.filter((item): item is HTMLLIElement => item !== null);
    if (!root || items.length === 0 || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (performance.now() < lockedUntil.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            touched.current = true;
            setActive(Number((entry.target as HTMLElement).dataset.index));
          }
        }
      },
      { root, threshold: 0.6 },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [screens.length]);

  const go = (index: number) => {
    const next = Math.max(0, Math.min(screens.length - 1, index));
    choose(next, true);
    lockedUntil.current = performance.now() + 700;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    slideRefs.current[next]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior });
  };

  const onKey = (event: React.KeyboardEvent, index: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = ['ArrowDown', rtl ? 'ArrowLeft' : 'ArrowRight'];
    const backward = ['ArrowUp', rtl ? 'ArrowRight' : 'ArrowLeft'];
    let next: number | null = null;
    if (forward.includes(event.key)) next = index + 1;
    else if (backward.includes(event.key)) next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = screens.length - 1;
    if (next === null) return;
    event.preventDefault();
    choose(next, true);
    tabRefs.current[(next + screens.length) % screens.length]?.focus();
  };

  const tabId = (key: string) => `${idBase}-tab-${key}`;
  const panelId = `${idBase}-panel`;
  const current = screens[active];

  return (
    <div className={className}>
      {/* From lg: the phone and the tabs. */}
      <div
        className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16"
        onPointerEnter={() => {
          hovering.current = true;
        }}
        onPointerLeave={() => {
          hovering.current = false;
        }}
      >
        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={tabId(current.key)}
          className="relative mx-auto w-[clamp(14rem,38vh,19rem)]"
        >
          <div
            aria-hidden
            className="absolute -inset-x-16 -inset-y-8 -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-blue)_30%,transparent),transparent)]"
          />
          <PhoneFrame>
            {screens.map((screen, index) => (
              <Screenshot
                key={screen.key}
                src={screen.src}
                alt={screen.alt}
                sizes="19rem"
                hidden={index !== active}
                className={stackedScreen(index === active)}
              />
            ))}
          </PhoneFrame>
        </div>

        <div role="tablist" aria-label={labels.list} aria-orientation="vertical" className="space-y-1">
          {screens.map((screen, index) => {
            const selected = index === active;
            return (
              <button
                key={screen.key}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={tabId(screen.key)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(index, true)}
                onKeyDown={(event) => onKey(event, index)}
                className={cn(
                  'flex w-full gap-5 rounded-2xl border-s-2 px-5 py-4 text-start transition-[background-color,border-color,opacity] duration-300 motion-reduce:transition-none',
                  selected
                    ? 'border-primary bg-muted/60 opacity-100'
                    : 'border-transparent opacity-70 hover:bg-muted/40 hover:opacity-100',
                )}
              >
                <span className="numeral mt-1 text-xs font-bold text-primary">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="block text-lg font-semibold leading-snug">{screen.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{screen.body}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Below lg: the row. */}
      <div className="lg:hidden">
        <ul
          ref={scroller}
          aria-label={labels.list}
          className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6"
        >
          {screens.map((screen, index) => (
            <li
              key={screen.key}
              data-index={index}
              ref={(element) => {
                slideRefs.current[index] = element;
              }}
              className="w-[66vw] max-w-[15rem] shrink-0 snap-center sm:w-60"
            >
              <PhoneFrame src={screen.src} alt={screen.alt} sizes="15rem" />
              <p className="mt-4 text-center font-semibold leading-snug">{screen.title}</p>
              <p className="mt-1 text-center text-sm leading-relaxed text-muted-foreground">{screen.body}</p>
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
            {screens.map((screen, index) => (
              <button
                key={screen.key}
                type="button"
                aria-label={screen.title}
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
            disabled={active === screens.length - 1}
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
