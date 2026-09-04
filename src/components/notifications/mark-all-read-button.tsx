'use client';

import { useTransition } from 'react';
import { CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markNotificationsRead } from '@/lib/actions/notifications';

/**
 * Only rendered when something is unread, so it never sits there doing
 * nothing. The action revalidates the console layout, which is where the badge
 * lives — otherwise the list would clear and the bell would keep its count.
 */
export function MarkAllReadButton({ label }: { label: string }) {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(async () => void (await markNotificationsRead()))}
    >
      <CheckCheck />
      {label}
    </Button>
  );
}
