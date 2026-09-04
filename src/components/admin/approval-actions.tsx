'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { setAccountApproval } from '@/lib/actions/admin';
import type { ApprovalStatus } from '@/lib/supabase/database.types';

/**
 * Approve or suspend one account.
 *
 * Rejecting asks for a reason before it will go through, because the person on
 * the other end is told what happened and "your account was suspended" with no
 * sentence after it is not something anybody can act on. Approving asks for
 * nothing — there is nothing to explain.
 */
export function ApprovalActions({
  userId,
  status,
}: {
  userId: string;
  status: ApprovalStatus;
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(next: ApprovalStatus, reason?: string) {
    startTransition(async () => {
      await setAccountApproval({ userId, status: next, note: reason });
      setRejecting(false);
      setNote('');
      router.refresh();
    });
  }

  if (rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('rejectReason')}
          className="h-9 w-56"
        />
        <Button
          variant="destructive"
          size="sm"
          disabled={pending || note.trim().length === 0}
          onClick={() => apply('rejected', note.trim())}
        >
          {t('confirmReject')}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRejecting(false)}>
          {tCommon('cancel')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'approved' ? (
        <Button variant="success" size="sm" disabled={pending} onClick={() => apply('approved')}>
          <Check />
          {t('approveAccount')}
        </Button>
      ) : null}

      {status !== 'rejected' ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setRejecting(true)}>
          <X />
          {t('suspendAccount')}
        </Button>
      ) : null}
    </div>
  );
}
