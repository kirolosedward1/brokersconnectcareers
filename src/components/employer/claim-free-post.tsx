'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Gift } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { claimMonthlyFreePost } from '@/lib/actions/company';

/**
 * Verified companies get one free single post per calendar month, permanently.
 * It keeps supply alive and gives the sales conversation an opening.
 */
export function ClaimFreePostButton({ claimed }: { claimed: boolean }) {
  const t = useTranslations('employer');
  const router = useRouter();
  const [done, setDone] = useState(claimed);
  const [pending, startTransition] = useTransition();

  if (done) {
    return <p className="text-sm text-muted-foreground">{t('freePostClaimed')}</p>;
  }

  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await claimMonthlyFreePost();
          if (result.ok) {
            setDone(true);
            router.refresh();
          }
        })
      }
    >
      <Gift />
      {t('freePostClaim')}
    </Button>
  );
}
