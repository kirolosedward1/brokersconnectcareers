import { CardListSkeleton, Skeleton } from '@/components/ui/skeleton';

export default function AgentsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="mt-6 h-16 w-full rounded-2xl" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <CardListSkeleton count={2} />
        <CardListSkeleton count={2} />
      </div>
    </div>
  );
}
