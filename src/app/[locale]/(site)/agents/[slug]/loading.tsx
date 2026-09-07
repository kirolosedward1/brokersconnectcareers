import { Skeleton } from '@/components/ui/skeleton';

/** One consultant's CV, not the directory. */
export default function AgentLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-start gap-4">
        <Skeleton className="size-20 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>

      <div className="mt-10 space-y-8">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
