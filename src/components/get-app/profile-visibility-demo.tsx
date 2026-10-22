'use client';

import { useId, useState } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

export type VisibilityOption = { key: 'public' | 'verified_employers_only' | 'hidden'; label: string; hint: string };

/**
 * A directory profile, drawn in HTML with nothing real on it — a blank
 * avatar, "your name", and three empty fields — under the choice the
 * product actually offers: shown to every approved company, to verified
 * companies only, or to nobody. The three labels and the line under them
 * are the onboarding form's own (`visibility.*`).
 *
 * Verified-only blurs the name, because that is what a company without the
 * badge sees: a card with no name. Hidden dims the whole card behind a
 * lock. A group of radio buttons drawn as a segmented control.
 */
export function ProfileVisibilityDemo({
  name,
  fields,
  legend,
  options,
  className,
}: {
  name: string;
  /** The three fields: areas, sales record, CV. */
  fields: readonly string[];
  legend: string;
  options: readonly VisibilityOption[];
  className?: string;
}) {
  const [active, setActive] = useState<VisibilityOption['key']>('public');
  const group = useId();
  const current = options.find((option) => option.key === active) ?? options[0];
  const hidden = active === 'hidden';
  const anonymous = active === 'verified_employers_only';

  return (
    <div className={cn('mx-auto w-full max-w-sm', className)}>
      <fieldset className="flex gap-1 rounded-2xl border border-border bg-card p-1">
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => (
          <label
            key={option.key}
            className={cn(
              'relative flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl px-2 text-center text-[0.8125rem] font-medium leading-tight transition-colors duration-200 motion-reduce:transition-none',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              option.key === active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name={group}
              value={option.key}
              checked={option.key === active}
              onChange={() => setActive(option.key)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="relative mt-4">
        <div
          aria-hidden
          className={cn(
            'rounded-[1.5rem] border border-border bg-card p-6 text-start shadow-sm transition-[opacity,filter] duration-500 motion-reduce:transition-none',
            hidden ? 'opacity-40 blur-[2px] saturate-50' : 'opacity-100',
          )}
        >
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="size-7" />
            </span>
            <div className="min-w-0">
              <p className={cn('font-semibold transition-[filter] duration-300', anonymous && 'blur-[5px]')}>{name}</p>
              <span className="mt-2 block h-2 w-24 rounded-full bg-border" />
            </div>
          </div>
          <dl className="mt-5 space-y-3.5">
            {fields.map((field, index) => (
              <div key={field}>
                <dt className="text-sm font-medium text-muted-foreground">{field}</dt>
                <dd className="mt-1.5 flex gap-2">
                  <span className={cn('h-2.5 rounded-full bg-border', index === 0 ? 'w-20' : index === 1 ? 'w-32' : 'w-24')} />
                  <span className="h-2.5 w-14 rounded-full bg-border" />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {hidden ? (
          <div aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold shadow-md">
              <Lock className="size-4 text-muted-foreground" />
              {current.label}
            </span>
          </div>
        ) : null}
      </div>

      <p className="mt-4 min-h-[3lh] text-center text-sm leading-relaxed text-muted-foreground" aria-live="polite">
        {current.hint}
      </p>
    </div>
  );
}
