'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BellPlus, BellRing } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { followCompany, unfollowCompany } from '@/lib/actions/saved-searches';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * "Tell me when this brokerage posts."
 *
 * Underneath it is a saved search with one filter, so what the reader gets is
 * the weekly digest they already understand, with the same unsubscribe link
 * and the same switch on the dashboard. The button says the outcome — you will
 * hear about new roles — rather than the mechanism.
 *
 * Offered to signed-out readers too, pointing at sign-in with a `next` back to
 * the company. Hiding it would mean only people who already have an account
 * ever discover it, which is backwards for something whose whole job is to
 * bring people back.
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
  const router = useRouter();

  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onClick() {
    if (!signedIn) {
      router.push(`/sign-in?next=${encodeURIComponent(`/companies/${slug}`)}`);
      return;
    }

    // Optimistic, like every other bookmark on the site: the state is one
    // click to restore, and waiting on a round trip to acknowledge a follow
    // makes the page feel broken.
    const next = !following;
    setFollowing(next);
    setError(null);

    startTransition(async () => {
      const result = next ? await followCompany({ slug, label }) : await unfollowCompany(slug);
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
