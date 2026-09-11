'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { withShareSource } from '@/lib/share-source';

/**
 * Share a listing.
 *
 * The copy for this has been sitting in the catalogue unused; the reverse
 * message check is what finally said so. It is worth the afternoon because
 * of where this market actually finds work: a consultant sees a listing and
 * forwards it to two people in a WhatsApp group. The share sheet on a phone
 * puts WhatsApp first, which makes this the cheapest distribution the board
 * has — and until now the only way to do it was to select the address bar.
 *
 * navigator.share needs a secure context and a user gesture, and is absent on
 * most desktop browsers, so the clipboard is not a fallback for failure but
 * the desktop path. A cancelled share sheet throws AbortError, which is a
 * person changing their mind rather than an error to report.
 */
export function ShareJobButton({ title }: { title: string }) {
  const t = useTranslations('jobs');
  const tCommon = useTranslations('common');
  const [copied, setCopied] = useState(false);

  async function share() {
    /*
      Tagged, so the arrival is visible.

      A WhatsApp forward carries no referrer, so a listing that spreads through
      a group lands in analytics as direct traffic and the cheapest
      distribution this board has is the one it cannot see. The tag is read and
      removed on arrival, so nobody ends up forwarding a share of a share.
    */
    const url = withShareSource(window.location.href);

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled, or refused by the platform. Fall through to the clipboard
        // rather than leaving the tap with nothing to show for it.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser with neither share nor clipboard permission. Nothing useful
      // to say, and an error toast for a share button is worse than silence.
    }
  }

  return (
    <Button variant="ghost" onClick={share}>
      {copied ? <Check aria-hidden /> : <Share2 aria-hidden />}
      {copied ? tCommon('saveSuccess') : t('share')}
    </Button>
  );
}
