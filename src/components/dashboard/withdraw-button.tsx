'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { withdrawApplication } from '@/lib/actions/applications';

export function WithdrawButton({
  applicationId,
  label,
}: {
  applicationId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await withdrawApplication(applicationId);
          router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}
