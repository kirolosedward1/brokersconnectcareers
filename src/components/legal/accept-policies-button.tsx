'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { acceptPolicies } from '@/lib/actions/policies';
import { reach } from '@/lib/reach';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * "I agree", under the notice that the Terms of use and the Privacy policy
 * changed. Its words arrive as props from the server component around it, so
 * the browser is sent two strings rather than a namespace.
 */
export function AcceptPoliciesButton({ label, failedLabel }: { label: string; failedLabel: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  return (
    <div className="shrink-0">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            const result = await reach(acceptPolicies());
            if (recoverSession(result)) return;
            if (result.ok) {
              router.refresh();
              return;
            }
            setFailed(true);
          })
        }
      >
        {label}
      </Button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {failedLabel}
        </p>
      ) : null}
    </div>
  );
}
