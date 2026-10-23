'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export type FilterGroup = {
  key: string;
  label: string;
  options: { key: string; label: string }[];
  /** One at a time, as a sort order is. */
  exclusive?: boolean;
  /** What is chosen before anybody touches it. */
  initial?: string[];
};

/**
 * The board's filters, as chips the reader can try.
 *
 * Decoration with real labels: the tracks, the lead sources and the sort
 * orders are the board's own words, and the areas are the eight the footer
 * links to. Nothing is filtered — the point is to show what can be asked
 * for — but every chip is a button that toggles, says so with
 * `aria-pressed`, and works from the keyboard like any other button.
 */
export function FilterDemo({
  groups,
  label,
  className,
}: {
  groups: FilterGroup[];
  /** The whole control's name. */
  label: string;
  className?: string;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.map((group) => [group.key, group.initial ?? []])),
  );

  const toggle = (group: FilterGroup, option: string) =>
    setChosen((current) => {
      const now = current[group.key] ?? [];
      const has = now.includes(option);
      const next = group.exclusive ? (has ? now : [option]) : has ? now.filter((key) => key !== option) : [...now, option];
      return { ...current, [group.key]: next };
    });

  return (
    <div
      role="group"
      aria-label={label}
      className={cn('rounded-[1.5rem] border border-border bg-card p-5 shadow-sm sm:p-6', className)}
    >
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.key} role="group" aria-label={group.label} className="text-center lg:text-start">
            <p className="text-sm font-semibold">{group.label}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2 lg:justify-start">
              {group.options.map((option) => {
                const pressed = (chosen[group.key] ?? []).includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => toggle(group, option.key)}
                    className={cn(
                      'inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none',
                      pressed
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
