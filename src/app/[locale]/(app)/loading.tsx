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
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* The strip and then rows — the shape of every console page now, so the
          placeholder no longer promises a wall of tiles that never arrives. */}
      <Skeleton className="h-[4.25rem] rounded-xl" />

      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
