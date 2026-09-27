'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { markNotificationsRead } from '@/lib/actions/notifications';
import { reach } from '@/lib/reach';

/**
 * Only rendered when something is unread, so it never sits there doing
 * nothing. The action revalidates the console layout, which is where the badge
 * lives — otherwise the list would clear and the bell would keep its count.
 *
 * `upTo` is the newest notification this screen showed, so a stale tab
 * cannot mark read something that arrived after it rendered.
 */
export function MarkAllReadButton({ label, upTo }: { label: string; upTo: string | null }) {
  const tCommon = useTranslations('common');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setFailed(false);
            const result = await reach(markNotificationsRead(upTo));
            if (!result.ok) setFailed(true);
          })
        }
      >
        <CheckCheck aria-hidden />
        {label}
      </Button>

      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {tCommon('errorBody')}
        </span>
      ) : null}
    </span>
  );
}
