'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WhatsAppMark } from '@/components/brand-marks';
import { revealAgentContact, type ContactRevealResult } from '@/lib/actions/agent-contact';
import { useSessionRecovery } from '@/lib/session-expired';
import { asLocale } from '@/i18n/routing';

/**
 * The button that asks for a number.
 *
 * Nothing about the consultant's contact is on this page until it is pressed:
 * not in the markup, not in a prop, not in a prefetched payload. The press
 * calls the server, the server calls the one database function that may
 * answer, and the answer arrives as a WhatsApp link and a CV link. A refusal
 * says what kind it was — the card is not open to this company, or this
 * account has opened enough cards for now — without naming a threshold.
 */
export function ContactReveal({
  handle,
  hasCv,
}: {
  handle: string;
  /** Whether a CV exists to offer once the contact is revealed. */
  hasCv: boolean;
}) {
  const t = useTranslations('agents');
  const tCommon = useTranslations('common');
  const locale = asLocale(useLocale());
  const recoverSession = useSessionRecovery();

  const [revealed, setRevealed] = useState<Extract<ContactRevealResult, { ok: true }>['data'] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reveal() {
    setMessage(null);
    startTransition(async () => {
      const result = await revealAgentContact({ handle, locale });
      if (recoverSession(result)) return;

      if (!result.ok) {
        if (result.error === 'rate_limit') {
          const minutes = Math.max(1, Math.ceil((result.retryAfterSeconds ?? 3600) / 60));
          setMessage(t('revealRateLimited', { minutes }));
        } else if (result.error === 'locked' || result.error === 'forbidden') {
          setMessage(t('revealLocked'));
        } else {
          setMessage(tCommon('errorBody'));
        }
        return;
      }

      setRevealed(result.data);
    });
  }

  if (revealed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="lg">
          <a href={revealed.whatsappUrl} target="_blank" rel="noopener noreferrer">
            <WhatsAppMark className="size-5 shrink-0" />
            {t('contact')}
          </a>
        </Button>
        <span className="numeral text-sm text-muted-foreground" dir="ltr">
          {revealed.phone}
        </span>
        {hasCv && revealed.hasCv ? (
          <Button asChild variant="outline" size="lg">
            <a href={`/api/agent-cv/${encodeURIComponent(handle)}`} target="_blank" rel="noopener noreferrer">
              <Download />
              {t('downloadCv')}
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="lg" onClick={reveal} disabled={pending}>
        <Eye />
        {pending ? tCommon('loading') : t('revealContact')}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
