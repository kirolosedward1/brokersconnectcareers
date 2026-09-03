'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

export type Step = {
  key: string;
  title: string;
  body: string;
  illustration: React.ReactNode;
};

/**
 * The hiring flow as vertical tabs: the steps on one side, the screen each one
 * produces on the other.
 *
 * Real tabs this time, with the full keyboard contract — arrow keys, Home and
 * End, manual activation, roving tabindex. The audience switcher in the hero
 * only looks like tabs and is really navigation, so it does not get this; these
 * genuinely swap panels in place, so they do.
 *
 * Arrow keys are direction-aware. In an RTL document the left arrow moves to
 * the *next* tab, and a component that hardcodes left-is-previous feels broken
 * to everyone reading right to left — which here is everyone.
 */
export function StepTabs({ steps, className }: { steps: Step[]; className?: string }) {
  const id = useId();
  const [active, setActive] = useState(0);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const last = steps.length - 1;

    let next: number | null = null;
    if (event.key === 'ArrowDown') next = active === last ? 0 : active + 1;
    if (event.key === 'ArrowUp') next = active === 0 ? last : active - 1;
    if (event.key === 'ArrowRight') next = rtl ? active + 1 : active - 1;
    if (event.key === 'ArrowLeft') next = rtl ? active - 1 : active + 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;

    if (next === null) return;
    event.preventDefault();

    const clamped = next < 0 ? last : next > last ? 0 : next;
    setActive(clamped);
    document.getElementById(`${id}-tab-${clamped}`)?.focus();
  }

  return (
    <div className={cn('grid gap-6 lg:grid-cols-[minmax(0,24rem)_1fr] lg:gap-10', className)}>
      <div
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="bg-brand-gradient flex flex-col gap-1 rounded-3xl p-3 shadow-lg sm:p-4"
      >
        {steps.map((step, index) => {
          const selected = index === active;
          return (
            <button
              key={step.key}
              id={`${id}-tab-${index}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              className={cn(
                'group/step rounded-2xl p-4 text-start transition-colors sm:p-5',
                selected ? 'bg-white/15 shadow-sm' : 'hover:bg-white/10',
              )}
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'numeral grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold transition-colors',
                    selected ? 'bg-white text-primary' : 'bg-white/15 text-white/80',
                  )}
                >
                  {index + 1}
                </span>
                <span
                  className={cn(
                    'font-semibold transition-colors',
                    selected ? 'text-white' : 'text-white/80',
                  )}
                >
                  {step.title}
                </span>
              </span>

              <span
                className={cn(
                  'mt-2 block text-sm leading-relaxed transition-colors',
                  selected ? 'text-white/80' : 'text-white/55',
                )}
              >
                {step.body}
              </span>
            </button>
          );
        })}
      </div>

      {/* One panel per step rather than one panel whose contents swap: it keeps
          each tab's aria-controls pointing at something real, and lets the
          inactive ones stay in the DOM so switching costs no layout. */}
      <div className="relative min-h-[20rem] rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-8">
        {steps.map((step, index) => (
          <div
            key={step.key}
            id={`${id}-panel-${index}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${index}`}
            hidden={index !== active}
            tabIndex={0}
            className="grid h-full place-items-center outline-none"
          >
            {step.illustration}
          </div>
        ))}
      </div>
    </div>
  );
}
