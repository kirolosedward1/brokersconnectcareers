import { Skeleton } from '@/components/ui/skeleton';

/**
 * A listing, not the board.
 *
 * Without this file the board's own loading state covers everything under
 * /jobs — so tapping a listing flashed a filter rail and a column of fake
 * result cards before the role appeared. A skeleton of the wrong page is worse
 * than none: it tells the reader they are somewhere they are not.
 *
 * The same reasoning gives /companies/[slug] and /agents/[slug] their own.
 */
export default function JobLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Skeleton className="h-4 w-48" />

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          <div className="flex items-start gap-3">
            <Skeleton className="size-12 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-28 rounded-full" />
          </div>

          {/* The compensation card, which is the reason this page exists. */}
          <Skeleton className="h-56 rounded-2xl" />

          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>

        <div className="hidden space-y-4 lg:block">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
