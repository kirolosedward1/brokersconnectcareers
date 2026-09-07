import { cn } from '@/lib/utils';

/**
 * The shape of content that has not arrived.
 *
 * These exist so a navigation has an immediate answer. Next streams a route's
 * loading file the moment you click, and without one the browser sits on the
 * previous page with nothing happening — which on a slow connection is
 * indistinguishable from a link that did not work, and gets tapped again.
 *
 * Deliberately dumb and deliberately approximate. A skeleton that tries to be
 * a pixel-perfect ghost of the real card becomes a second copy of that card's
 * layout, and the two drift the first time anybody edits one. What has to be
 * right is the block's rough size, so the page does not jump when the content
 * lands.
 *
 * `motion-safe` because a grid of pulsing blocks is exactly the kind of thing
 * somebody with a vestibular disorder turned animation off to avoid; without
 * it they still get the layout, just still.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('motion-safe:animate-pulse rounded-lg bg-muted', className)}
    />
  );
}

/** A stand-in for one job or company row. */
export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-14 w-16 shrink-0 rounded-xl" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-5/6" />
        <div className="flex flex-wrap gap-2 pt-1">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * A list of them. The count is what fits above the fold on a phone — more
 * would be drawing skeletons nobody sees before the real data replaces them.
 */
export function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}
