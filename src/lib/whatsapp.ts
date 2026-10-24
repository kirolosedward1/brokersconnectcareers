import type { Locale } from '@/lib/locale';

/**
 * Pre-filled Arabic opener for the employer -> candidate WhatsApp deep link.
 * Employers should not have to compose the first message; the whole point of
 * the applicant card is that contact is one tap away.
 */
export function employerOpener(params: {
  candidateName: string;
  jobTitle: string;
  companyName: string;
  locale: Locale;
}): string {
  const { candidateName, jobTitle, companyName, locale } = params;

  if (locale === 'en') {
    return `Hello ${candidateName}, this is ${companyName}. We received your application for "${jobTitle}" and would like to talk. Is now a good time?`;
  }

  return `مرحباً ${candidateName}، معك ${companyName}. وصلنا طلبك على وظيفة «${jobTitle}» ونود التحدث معك. هل الوقت مناسب الآن؟`;
}

/** Candidate -> agent opener, used from the gated agent profile. */
export function employerToAgentOpener(params: {
  agentName: string;
  companyName: string;
  locale: Locale;
}): string {
  const { agentName, companyName, locale } = params;

  if (locale === 'en') {
    return `Hello ${agentName}, this is ${companyName}. We found your profile on the consultant directory and have an opening that may suit you.`;
  }

  return `مرحباً ${agentName}، معك ${companyName}. رأينا ملفك في دليل الاستشاريين ولدينا فرصة قد تناسبك.`;
}

/**
 * Contact in this market is WhatsApp, not email. wa.me wants a bare
 * international number with no `+` and no separators.
 */
export function whatsappLink(phone: string, message?: string): string {
  const digits = phone.replace(/\D/g, '');
  const query = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${query}`;
}
