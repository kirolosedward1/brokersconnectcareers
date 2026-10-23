'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The company page's follow button, to press, with the line the app shows
 * under it: what following does before, and what it is doing after. The
 * labels and both lines are the company page's own (`companies.*`).
 * Decoration that says its state with `aria-pressed`.
 */
export function FollowButtonDemo({
  follow,
  following,
  followHint,
  followingHint,
  className,
}: {
  follow: string;
  following: string;
  followHint: string;
  followingHint: string;
  className?: string;
}) {
  const [on, setOn] = useState(false);

  return (
    <div className={cn('flex flex-col items-center gap-3 lg:items-start', className)}>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setOn((value) => !value)}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.97] motion-reduce:transition-none',
          on
            ? 'border-success bg-success-muted text-success'
            : 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover',
        )}
      >
        {on ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {on ? following : follow}
      </button>
      <p className="max-w-sm text-center text-sm leading-relaxed text-muted-foreground lg:text-start" aria-live="polite">
        {on ? followingHint : followHint}
      </p>
    </div>
  );
}
