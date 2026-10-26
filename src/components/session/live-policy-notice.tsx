'use client';

import { useSession } from '@/components/session/session-provider';
import { AcceptPoliciesButton } from '@/components/legal/accept-policies-button';

/**
 * The "please agree again" band.
 *
 * Empty in the cached HTML. It appears only after /api/chrome says this
 * account has not agreed to the documents as they are published now, and the
 * header stops floating over it at the same time.
 */
export function LivePolicyNotice({
  agreeLabel,
  failedLabel,
  children,
}: {
  agreeLabel: string;
  failedLabel: string;
  children: React.ReactNode;
}) {
  const session = useSession();
  if (session.kind !== 'user' || !session.asksToAgree) return null;

  return (
    <section aria-labelledby="policy-notice-title" className="border-b border-primary/20 bg-primary/[0.04]">
      <div className="shell flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        {children}
        <AcceptPoliciesButton label={agreeLabel} failedLabel={failedLabel} />
      </div>
    </section>
  );
}
