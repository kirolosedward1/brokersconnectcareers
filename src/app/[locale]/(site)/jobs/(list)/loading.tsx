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
    <div className="shell py-6">
      <Skeleton className="h-7 w-40" />

      <div className="mt-4 grid gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:gap-8">
        <div className="hidden space-y-6 lg:block">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>

        <div>
          <CardListSkeleton count={6} />
        </div>
      </div>
    </div>
  );
}
