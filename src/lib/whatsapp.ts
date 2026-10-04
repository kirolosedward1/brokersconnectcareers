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

  return `أهلاً ${candidateName}، معك ${companyName}. وصلنا طلبك على وظيفة "${jobTitle}" ونحب نتكلم معك. الوقت مناسب دلوقتي؟`;
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

  return `أهلاً ${agentName}، معك ${companyName}. شفنا ملفك في دليل الاستشاريين وعندنا فرصة ممكن تناسبك.`;
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
