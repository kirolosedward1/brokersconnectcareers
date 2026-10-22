'use client';

import { useId, useState } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A directory profile, drawn in HTML with nothing real on it — a blank
 * avatar, "your name here", and three empty fields — under the one control
 * that matters: whether companies see it. Off, the card dims and blurs and
 * a lock says it is hidden. The switch is a real switch (`role="switch"`,
 * `aria-checked`), and the state is announced.
 */
export function ProfileVisibilityDemo({
  name,
  fields,
  visible,
  hidden,
  className,
}: {
  name: string;
  /** The three fields: areas, sales record, CV. */
  fields: readonly string[];
  /** The switch's label when on. */
  visible: string;
  /** The lock's words, and the switch's label when off. */
  hidden: string;
  className?: string;
}) {
  const [shown, setShown] = useState(true);
  const id = useId();

  return (
    <div className={cn('mx-auto w-full max-w-sm', className)}>
      <div className="relative">
        <div
          aria-hidden={!shown}
          className={cn(
            'rounded-[1.5rem] border border-border bg-card p-6 shadow-sm transition-[opacity,filter] duration-500 motion-reduce:transition-none',
            shown ? 'opacity-100' : 'opacity-50 blur-[2px] saturate-50',
          )}
        >
          <div className="flex items-center gap-4">
            <span className="grid size-16 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="size-8" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{name}</p>
              <span aria-hidden className="mt-2 block h-2 w-28 rounded-full bg-border" />
            </div>
          </div>

          <dl className="mt-6 space-y-4">
            {fields.map((field, index) => (
              <div key={field}>
                <dt className="text-sm font-medium text-muted-foreground">{field}</dt>
                <dd aria-hidden className="mt-1.5 flex gap-2">
                  <span className={cn('h-2.5 rounded-full bg-border', index === 0 ? 'w-20' : index === 1 ? 'w-32' : 'w-24')} />
                  <span className="h-2.5 w-16 rounded-full bg-border" />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {shown ? null : (
          <div className="absolute inset-0 grid place-items-center rounded-[1.5rem]">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold shadow-md">
              <Lock className="size-4 text-muted-foreground" aria-hidden />
              {hidden}
            </span>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-3">
        <span id={id} className="text-sm font-semibold">
          {shown ? visible : hidden}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={shown}
          aria-labelledby={id}
          onClick={() => setShown((value) => !value)}
          className={cn(
            'relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none',
            shown ? 'bg-success' : 'bg-input',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute top-1 size-6 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none',
              'start-1',
              shown ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-0',
            )}
          />
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {shown ? visible : hidden}
      </p>
    </div>
  );
}
