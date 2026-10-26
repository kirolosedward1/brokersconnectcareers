'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BellPlus, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSignInGate } from '@/components/auth/sign-in-gate';
import { cn } from '@/lib/utils';
import { followCompany, unfollowCompany } from '@/lib/actions/saved-searches';
import { reach } from '@/lib/reach';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * "Tell me when this brokerage posts."
 *
 * Underneath it is a saved search with one filter, so what the reader gets is
 * the weekly digest they already understand, with the same unsubscribe link
 * and the same switch on the dashboard. The button says the outcome — you will
 * hear about new roles — rather than the mechanism.
 *
 * Offered to signed-out readers too: pressed, the sign-in dialog opens over
 * the page (sign-in-gate.tsx) and the follow goes through once they are in,
 * with `next` back to the company for a sign-up or a one-tap provider. Hiding
 * it would mean only people who already have an account ever discover it,
 * which is backwards for something whose whole job is to bring people back.
 *
 * Signed-in readers get it only if they are candidates, which the company page
 * decides — the row this writes is a candidate's, and the insert policy says
 * so too. `signedIn` is therefore about where the press goes, not about who is
 * allowed to press.
 */
export function FollowCompanyButton({
  slug,
  label,
  initialFollowing,
  signedIn,
  className,
}: {
  slug: string;
  /** The company's name in the reader's language — the digest's subject line. */
  label: string;
  initialFollowing: boolean;
  signedIn: boolean;
  className?: string;
}) {
  const t = useTranslations('companies');
  const tCommon = useTranslations('common');
  const requireSignIn = useSignInGate();

  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onClick() {
    if (!signedIn) {
      void requireSignIn({ reason: 'follow', next: `/companies/${slug}` }).then((ok) => {
        if (ok) toggle();
      });
      return;
    }
    toggle();
  }

  function toggle() {
    // Optimistic, like every other bookmark on the site: the state is one
    // click to restore, and waiting on a round trip to acknowledge a follow
    // makes the page feel broken.
    const next = !following;
    setFollowing(next);
    setError(null);

    startTransition(async () => {
      const result = next ? await reach(followCompany({ slug, label })) : await reach(unfollowCompany(slug));
      if (recoverSession(result)) return;

      if (!result.ok) {
        setFollowing(!next);
        // The ten-row limit is shared with saved searches, so the message has
        // to name both — "you already follow ten companies" would be wrong for
        // somebody holding nine searches and one follow.
        setError(result.error === 'cap' ? t('followCap') : tCommon('errorBody'));
      }
    });
  }

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <Button
        variant={following ? 'secondary' : 'outline'}
        onClick={onClick}
        disabled={pending}
        aria-pressed={following}
      >
        {following ? <BellRing aria-hidden /> : <BellPlus aria-hidden />}
        {following ? t('following') : t('follow')}
      </Button>

      {/* Bounded on a wide screen, where it sits beside the company name and
          a long line would drag the header taller; unbounded on a phone, where
          it has the row to itself. */}
      <p className="text-xs text-muted-foreground sm:max-w-56">
        {following ? t('followingHint') : t('followHint')}
      </p>

      {error ? (
        <p role="alert" className="text-xs text-destructive sm:max-w-56">
          {error}
        </p>
      ) : null}
    </div>
  );
}
