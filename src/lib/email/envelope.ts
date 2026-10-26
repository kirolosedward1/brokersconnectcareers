import 'server-only';
import { dirOf } from '@/i18n/routing';
import { configuredValue, env } from '@/lib/env';
import { copyFor } from './copy';
import { renderEmail, renderText, type Block } from './components';
import type { Envelope } from './service';

/**
 * Subject, HTML and text, built once from the same blocks.
 *
 * Templates call this instead of the renderers directly, so the footer — the
 * contact line, the legal links, the unsubscribe or its deliberate absence —
 * is identical everywhere and cannot be forgotten by a template added later.
 * It is also the single place the logo URL is made absolute; a relative path
 * in an email resolves against nothing.
 */

export type Audience = {
  locale: 'ar' | 'en';
  /**
   * Present on optional mail only. Transactional messages pass nothing, and
   * that absence is the difference between the two categories — not a flag
   * somewhere that a template has to remember to check. The page is the
   * footer's link; one-click is the List-Unsubscribe header's address
   * (unsubscribeLinks).
   */
  unsubscribe?: { page: string; oneClick: string };
};

export function buildEnvelope({
  audience,
  subject,
  preheader,
  heading,
  blocks,
}: {
  audience: Audience;
  subject: string;
  preheader: string;
  heading: string;
  blocks: Block[];
}): Envelope {
  const c = copyFor(audience.locale);

  // The same line on every template. A configured support address is where a
  // reply lands (the message also sets Reply-To to it). Without one, the line
  // stays neutral and does not tell the reader not to reply.
  const support = configuredValue(env.supportEmail);
  const footer = {
    contact: support ? { lead: c.footer.reply, email: support } : { lead: c.footer.neutral },
    reason: audience.unsubscribe ? c.footer.reasonOptional : c.footer.reasonAccount,
    legal: [
      { label: c.footer.privacy, href: `${env.siteUrl}/privacy` },
      { label: c.footer.terms, href: `${env.siteUrl}/terms` },
    ],
    unsubscribe: audience.unsubscribe
      ? { label: c.unsubscribe, href: audience.unsubscribe.page }
      : undefined,
  };

  return {
    subject,
    html: renderEmail({
      locale: audience.locale,
      dir: dirOf(audience.locale),
      siteName: c.siteName,
      // Arabic wordmark for Arabic, the square mark for English — the Arabic
      // lockup is the only one that exists, and it reads as a foreign asset in
      // an English message.
      logoUrl:
        audience.locale === 'ar'
          ? `${env.siteUrl}/brand/logo-ar.png`
          : undefined,
      preheader,
      heading,
      blocks,
      footer,
    }),
    text: renderText({ heading, blocks, footer, siteName: c.siteName }),
    unsubscribeUrl: audience.unsubscribe?.oneClick,
  };
}
