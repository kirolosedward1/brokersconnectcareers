import 'server-only';
import {
  notifyApplicationWithdrawn,
  notifyCandidateOfApplication,
  notifyCandidateOfStatus,
  notifyCompanyVerification,
  notifyEmployerOfApplication,
  notifyEmployerOfModeration,
  notifyJobSubmitted,
  notifyWelcome,
} from './notify';
import type { SendOutcome } from './send';

/**
 * How a failed message is tried again.
 *
 * The outbox stores no message body — the support question is "did it go", not
 * "what did it say", and a copy of every status change ever mailed to a
 * candidate would be a second unguarded copy of the pipeline kept forever. So
 * a retry re-derives the message from the entity it was about, which is also
 * the more honest behaviour: a listing renamed between the failure and the
 * retry goes out with its current name rather than a stale snapshot.
 *
 * Only messages that can be re-derived appear here. A digest is a point-in-time
 * list of what was new that week; re-sending one three days later would be
 * worse than not sending it, so digests are deliberately absent and simply
 * expire out of the sweeper's window.
 */

type Rebuild = (entityId: string) => Promise<SendOutcome>;

export const REBUILDERS: Record<string, Rebuild> = {
  new_application: (id) => notifyEmployerOfApplication(id),
  application_receipt: (id) => notifyCandidateOfApplication(id),
  application_status: (id) => notifyCandidateOfStatus(id),
  application_rejected: (id) => notifyCandidateOfStatus(id),
  job_submitted: (id) => notifyJobSubmitted(id),
  job_approved: (id) => notifyEmployerOfModeration(id, true),
  job_rejected: (id) => notifyEmployerOfModeration(id, false),
  company_verified: (id) => notifyCompanyVerification(id, true),
  company_verification_needed: (id) => notifyCompanyVerification(id, false),
  welcome_candidate: (id) => notifyWelcome(id),
  welcome_employer: (id) => notifyWelcome(id),
};

/**
 * Not retryable, and each for a reason rather than by omission:
 *
 *   saved_search_digest / applicant_digest — a point-in-time list. Stale is
 *     worse than absent.
 *   application_withdrawn — the application row is gone; there is nothing left
 *     to rebuild from.
 *   profile_ready / visibility_changed / account_approved / account_rejected —
 *     these carry a value at a moment (the visibility chosen, the decision
 *     made). Re-deriving would report the *current* value, which may no longer
 *     be the thing that was being announced.
 */
export const NOT_RETRYABLE = [
  'saved_search_digest',
  'applicant_digest',
  'application_withdrawn',
  'profile_ready',
  'visibility_changed',
  'account_approved',
  'account_rejected',
] as const;

/** Unused export kept honest: every template is either rebuilt or listed above. */
export function isRetryable(template: string): boolean {
  return template in REBUILDERS;
}
