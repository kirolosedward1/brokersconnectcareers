'use client';

import { useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { Select } from '@/components/ui/field';
import type { JobSort } from '@/lib/queries/jobs';

export function SortSelect({
  value,
  labels,
}: {
  value: JobSort;
  labels: Record<JobSort, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(searchParams.toString());
    if (event.target.value === 'newest') next.delete('sort');
    else next.set('sort', event.target.value);
    next.delete('page');

    const query = next.toString();
    startTransition(() => router.replace(query ? `/jobs?${query}` : '/jobs', { scroll: false }));
  }

  return (
    <Select
      id="sort"
      value={value}
      onChange={onChange}
      disabled={pending}
      className="h-9 w-auto min-w-36"
    >
      <option value="newest">{labels.newest}</option>
      <option value="salary">{labels.salary}</option>
      <option value="seats">{labels.seats}</option>
    </Select>
  );
}
