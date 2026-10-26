/**
 * The emails the sweeper can rebuild from their row alone — template and
 * entity id — and so the dead letters worth another try (requeueEmail, the
 * Retry button on /admin/operations and in the app's console). Shared by
 * rebuild.ts, which holds the rebuilders themselves and is server-only, and
 * by the app, which hides Retry where the website hides it. rebuild.ts
 * checks at load that its rebuilders and this list are the same set.
 */
export const RETRYABLE_TEMPLATES = [
  'new_application',
  'application_receipt',
  'application_status',
  'application_rejected',
  'job_submitted',
  'job_approved',
  'job_approved_owner',
  'job_rejected',
  'candidate_withdrew',
  'company_verified',
  'company_verification_needed',
  'company_verification_revoked',
  'welcome_candidate',
  'welcome_employer',
  'profile_incomplete',
  'job_expiring',
  'job_expired',
] as const;

export type RetryableTemplate = (typeof RETRYABLE_TEMPLATES)[number];

export function isRetryable(template: string): template is RetryableTemplate {
  return (RETRYABLE_TEMPLATES as readonly string[]).includes(template);
}
