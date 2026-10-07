'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { startCheckout } from '@/lib/actions/billing';
import { isPaymentPage } from '@/lib/paymob/checkout-url';
import { reach } from '@/lib/reach';
import { useSessionRecovery } from '@/lib/session-expired';
import type { PACKS_ON_SALE } from '@/lib/taxonomy';

/**
 * Buys one pack: the server opens the order and the payment page, and the
 * browser goes there. The button this replaces had no handler at all — on the
 * day billing opened it would have been a "Buy" that did nothing.
 */
export function BuyPackButton({ packKey }: { packKey: (typeof PACKS_ON_SALE)[number]['key'] }) {
  const t = useTranslations('billing');
  const [failed, setFailed] = useState<'buyFailed' | 'buyForbidden' | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  return (
    <div className="mt-5 space-y-2">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(null);
            const result = await reach(startCheckout({ packKey }));
            if (recoverSession(result)) return;
            // Only to Paymob's own payment page, whatever the answer says.
            if (result.ok && result.data?.url && isPaymentPage(result.data.url)) {
              window.location.assign(result.data.url);
              return;
            }
            // Who may buy is not something trying again changes: a team
            // member who is not the company's admin, or an account not
            // approved yet, is told who can, not to wait a moment.
            setFailed(
              !result.ok && (result.error === 'forbidden' || result.error === 'no_company')
                ? 'buyForbidden'
                : 'buyFailed',
            );
          })
        }
      >
        {t('buy')}
      </Button>

      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t(failed)}
        </p>
      ) : null}
    </div>
  );
}
