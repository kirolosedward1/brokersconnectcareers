import { CardListSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * Shown the instant somebody asks for the board, while the query runs.
 *
 * It mirrors the real page's two-column frame — filter rail beside results —
 * so the layout does not jump when the listings land.
 *
 * The (list) route group is why this file is here rather than one level up. A
 * loading file wraps its whole segment, children included, so at /jobs it also
 * covered /jobs/[slug] and /jobs/[slug]/apply — and opening a shared listing
 * emitted a filter rail and a column of fake result cards before the role
 * appeared. Checked in the streamed HTML: the board's fallback came first, the
 * listing's second, the actual listing third. The group takes the board out of
 * its children's path without changing a single URL.
 */
export default function JobsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Skeleton className="h-8 w-40" />

      <div className="mt-6 grid gap-8 lg:grid-cols-[17rem_1fr]">
        <div className="hidden space-y-6 lg:block">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <Skeleton className="h-5 w-32" />
          <CardListSkeleton count={5} />
        </div>
      </div>
    </div>
  );
}
