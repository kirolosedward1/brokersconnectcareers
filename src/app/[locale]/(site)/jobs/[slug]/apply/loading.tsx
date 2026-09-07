import { Skeleton } from '@/components/ui/skeleton';

/** A short form, not a listing and not the board. */
export default function ApplyLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <div className="space-y-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>

      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ))}

      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
