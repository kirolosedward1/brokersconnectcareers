'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The company page's follow button, to press: it turns into "following"
 * with a check, and back. Decoration that says so with `aria-pressed`.
 */
export function FollowButtonDemo({
  follow,
  following,
  className,
}: {
  follow: string;
  following: string;
  className?: string;
}) {
  const [on, setOn] = useState(false);

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setOn((value) => !value)}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.97] motion-reduce:transition-none',
        on
          ? 'border-success bg-success-muted text-success'
          : 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover',
        className,
      )}
    >
      {on ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
      {on ? following : follow}
    </button>
  );
}
