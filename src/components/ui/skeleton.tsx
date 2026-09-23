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

/**
 * A stand-in for one job or company row.
 *
 * Shaped like the row it stands in for: a mark, a title, and two lines of
 * facts at the row's own padding. It used to be the old card — a seats panel
 * in the corner and three pills underneath — so when the data arrived every
 * row on the page changed height and the list jumped under the reader's eye.
 */
export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2.5 py-0.5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <Skeleton className="h-3 w-14 shrink-0" />
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
    <div className="space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <CardSkeleton key={index} />
      ))}
    </div>
  );
}
