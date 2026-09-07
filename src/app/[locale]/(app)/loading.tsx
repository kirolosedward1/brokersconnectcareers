import { Skeleton } from '@/components/ui/skeleton';

/**
 * One file for the whole console.
 *
 * Every page under it opens the same way — a heading, then a grid of tiles or
 * a list — so a single approximate frame covers all of them. Per-page
 * skeletons here would be six near-identical files drifting apart.
 */
export default function AppLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
