'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WhatsAppMark } from '@/components/brand-marks';
import { whatsappLink } from '@/lib/utils';

/**
 * A consultant's contact details, for a viewer who is allowed them.
 *
 * Nothing here decides that. The number arrives only when get_agent_card()
 * unlocked the card for this viewer, and the page offers this block only when
 * `canContactAgent` says so; by the time this renders, the question has been
 * answered twice. What this does is make the number usable on a phone: a
 * WhatsApp deep link with the opener already written, a tel: link for the
 * people who still call, and a copy button for the number itself — drawn
 * left-to-right in a right-to-left page, because a phone number is a string
 * of digits and not a sentence.
 */
export function AgentContact({
  phone,
  opener,
}: {
  /** E.164, `+20…` — as stored. */
  phone: string;
  /** The pre-written first message for WhatsApp. */
  opener: string;
}) {
  const t = useTranslations('agents');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused inside an in-app browser. The number is
      // on screen, so there is still a way.
    }
  }

  return (
    <section
      aria-labelledby="agent-contact"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <h2 id="agent-contact" className="text-sm font-semibold">
        {t('contactTitle')}
      </h2>

      {/* `dir="ltr"` on the number and `bdi` around it: without both, the
          leading plus and the digit groups reorder themselves inside Arabic
          text, and a copied number is not the number on the screen. */}
      <p className="mt-2 text-lg font-semibold">
        <bdi dir="ltr" className="numeral">
          {phone}
        </bdi>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild>
          <a href={whatsappLink(phone, opener)} target="_blank" rel="noopener noreferrer">
            <WhatsAppMark className="size-4 shrink-0" />
            {t('contact')}
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={`tel:${phone}`}>
            <Phone aria-hidden />
            {t('call')}
          </a>
        </Button>
        <Button type="button" variant="ghost" onClick={copy} aria-live="polite">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t('copied') : t('copyNumber')}
        </Button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('contactHint')}</p>
    </section>
  );
}
