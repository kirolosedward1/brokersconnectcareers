import { CardListSkeleton, Skeleton } from '@/components/ui/skeleton';

export default function AgentsLoading() {
  return (
    <div className="shell py-8">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="mt-6 h-16 w-full rounded-xl" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <CardListSkeleton count={2} />
        <CardListSkeleton count={2} />
      </div>
    </div>
  );
}
