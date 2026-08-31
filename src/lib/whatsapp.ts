import type { Locale } from '@/i18n/routing';

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
    return `Hello ${agentName}, this is ${companyName}. We found your profile on the agent directory and have an opening that may suit you.`;
  }

  return `أهلاً ${agentName}، معك ${companyName}. شفنا ملفك في دليل المسوقين وعندنا فرصة ممكن تناسبك.`;
}
