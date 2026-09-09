import 'server-only';
import { dirOf } from '@/i18n/routing';
import { env } from '@/lib/env';
import { copyFor } from './copy';
import { renderEmail, renderText, type Block } from './components';
import type { Envelope } from './service';

/**
 * Subject, HTML and text, built once from the same blocks.
 *
 * Templates call this instead of the renderers directly, so the footer — the
 * automated-message line, the legal links, the unsubscribe or its deliberate
 * absence — is identical everywhere and cannot be forgotten by a template
 * added later. It is also the single place the logo URL is made absolute; a
 * relative path in an email resolves against nothing.
 */

export type Audience = {
  locale: 'ar' | 'en';
  /**
   * Present on optional mail only. Transactional messages pass nothing, and
   * that absence is the difference between the two categories — not a flag
   * somewhere that a template has to remember to check.
   */
  unsubscribe?: string;
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

  // Appended here rather than in each template: a help line that exists in
  // nineteen templates out of twenty is a bug in the twentieth.
  //
  // Conditional, because this platform has no support page. Without a
  // configured address the block is omitted entirely rather than pointing at a
  // route that would 404 — an email that offers help and delivers a missing
  // page is worse than one that offers none.
  const withHelp: Block[] = env.supportEmail
    ? [
        ...blocks,
        {
          kind: 'help',
          value: c.footer.help,
          link: { label: env.supportEmail, href: `mailto:${env.supportEmail}` },
        },
      ]
    : blocks;

  const footer = {
    automated: c.footer.automated,
    reason: audience.unsubscribe ? c.footer.reasonOptional : c.footer.reasonAccount,
    legal: [
      { label: c.footer.privacy, href: `${env.siteUrl}/privacy` },
      { label: c.footer.terms, href: `${env.siteUrl}/terms` },
    ],
    unsubscribe: audience.unsubscribe
      ? { label: c.unsubscribe, href: audience.unsubscribe }
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
      blocks: withHelp,
      footer,
    }),
    text: renderText({ heading, blocks: withHelp, footer, siteName: c.siteName }),
    unsubscribeUrl: audience.unsubscribe,
  };
}
