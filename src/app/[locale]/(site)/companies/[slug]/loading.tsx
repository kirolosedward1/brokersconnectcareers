import { CardListSkeleton, Skeleton } from '@/components/ui/skeleton';

/** A company profile, not the directory listing it was reached from. */
export default function CompanyLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-start gap-4">
        <Skeleton className="size-16 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>

      <div className="mt-10 space-y-4">
        <Skeleton className="h-5 w-40" />
        <CardListSkeleton count={3} />
      </div>
    </div>
  );
}
