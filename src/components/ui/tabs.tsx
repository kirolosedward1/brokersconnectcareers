'use client';

import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type TabDefinition = { id: string; label: string };

/**
 * WAI-ARIA tabs with manual activation — arrow keys move focus, Enter/Space
 * selects. Automatic activation would be smoother with a mouse but makes the
 * panel change under a keyboard user who is only passing through.
 *
 * Arrow direction follows what is on screen, not the DOM: under RTL the right
 * arrow moves to the previous tab, because that is where it sits.
 */
export function Tabs({
  tabs,
  panels,
  className,
}: {
  tabs: TabDefinition[];
  panels: React.ReactNode[];
  className?: string;
}) {
  const base = useId();
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(to: number) {
    const next = (to + tabs.length) % tabs.length;
    setFocused(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl =
      typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';

    if (event.key === forward) {
      event.preventDefault();
      move(index + 1);
    } else if (event.key === backward) {
      event.preventDefault();
      move(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(tabs.length - 1);
    }
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="mx-auto flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-sm"
      >
        {tabs.map((tab, index) => {
          const selected = index === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                refs.current[index] = node;
              }}
              role="tab"
              type="button"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              // Only the active tab is in the tab order; arrows do the rest.
              tabIndex={index === focused ? 0 : -1}
              onClick={() => {
                setActive(index);
                setFocused(index);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-medium transition-colors',
                selected
                  ? 'bg-brand-gradient text-primary-foreground shadow-[var(--shadow-primary)]'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {panels.map((panel, index) => (
        <div
          key={tabs[index]?.id ?? index}
          role="tabpanel"
          id={`${base}-panel-${tabs[index]?.id}`}
          aria-labelledby={`${base}-tab-${tabs[index]?.id}`}
          hidden={index !== active}
          tabIndex={0}
          className="mt-10 focus-visible:outline-none"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
