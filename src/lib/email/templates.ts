/**
 * Every message the platform sends, by name, with the one fact about each that
 * the send path needs: what kind of message it is.
 *
 *   security      — somebody's account or visibility changed. Sent even to an
 *                   address that has complained, and exempt from the
 *                   per-recipient ceiling, because the whole value of the
 *                   message is reaching a person about a change they may not
 *                   have made. Never carries an unsubscribe.
 *   transactional — a receipt or an answer to something the person did. No
 *                   unsubscribe, no preference, but a complaint stops it.
 *   preference    — a stream the person can turn off (notify_* on profiles).
 *                   Carries the one-click unsubscribe headers.
 *
 * A name that is not in this map does not type-check at deliver(), so a
 * template cannot be added without somebody deciding which of the three it is.
 *
 * No `server-only` marker: it holds no secrets, and the test suite imports it.
 */

export const TEMPLATES = {
  password_changed: 'security',
  visibility_changed: 'security',
  account_approved: 'security',
  account_rejected: 'security',

  welcome_candidate: 'transactional',
  welcome_employer: 'transactional',
  profile_ready: 'transactional',
  application_receipt: 'transactional',
  application_withdrawn: 'transactional',
  job_submitted: 'transactional',
  company_verified: 'transactional',
  company_verification_needed: 'transactional',

  new_application: 'preference',
  applicant_digest: 'preference',
  application_status: 'preference',
  application_rejected: 'preference',
  job_approved: 'preference',
  job_rejected: 'preference',
  job_expiring: 'preference',
  job_expired: 'preference',
  profile_incomplete: 'preference',
  saved_search_digest: 'preference',
  company_follow_digest: 'preference',
} as const satisfies Record<string, 'security' | 'transactional' | 'preference'>;

export type TemplateName = keyof typeof TEMPLATES;
export type TemplateCategory = (typeof TEMPLATES)[TemplateName];

export function isEssential(template: TemplateName): boolean {
  return TEMPLATES[template] === 'security';
}
