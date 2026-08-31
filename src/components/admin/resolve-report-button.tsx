'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { resolveReport } from '@/lib/actions/admin';

export function ResolveReportButton({ reportId, label }: { reportId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await resolveReport(reportId);
          router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}
