import { CardListSkeleton, Skeleton } from '@/components/ui/skeleton';

export default function CompaniesLoading() {
  return (
    <div className="shell py-8">
      <Skeleton className="h-8 w-36" />
      <Skeleton className="mt-6 h-16 w-full rounded-xl" />
      <div className="mt-6">
        <CardListSkeleton count={5} />
      </div>
    </div>
  );
}
