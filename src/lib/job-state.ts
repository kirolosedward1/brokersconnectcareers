import type { JobStatus } from '@/lib/supabase/database.types';

/**
 * Whether a listing is live, decided by the date rather than by the label.
 *
 * `status` is flipped to `expired` by a nightly cron, so a listing whose
 * `expires_at` passed an hour ago still reads `active` — and on production it
 * reads `active` indefinitely, because the cron needs a service-role key that
 * is not configured and returns 503 without it. One listing has been `active`
 * with an expiry in the past since 10 September.
 *
 * The public board and the apply page already asked the date. The employer's
 * own console did not, so it showed "منشورة", a link to a page the site
 * renders as closed, and an expiry date in the past — while the board showed
 * nothing. The cron tidies the stored label; it is not what makes the answer
 * true.
 */
export function jobIsLive(job: {
  status: JobStatus;
  expires_at: string | null;
}): boolean {
  return job.status === 'active' && (!job.expires_at || new Date(job.expires_at) > new Date());
}

/**
 * The status to show, which is the stored one unless the window has run out
 * under it.
 */
export function displayJobStatus(job: { status: JobStatus; expires_at: string | null }): JobStatus {
  return job.status === 'active' && !jobIsLive(job) ? 'expired' : job.status;
}

/**
 * Whether an anonymous visitor can open the listing's page at all — the
 * labels `jobs_select_active` lets through: live, run out, or closed by its
 * owner. Drafts, listings in review and rejected ones are the company's own
 * business and answer 404 to everybody else. This is the question a search
 * engine's copy of the page depends on, not whether it takes applications.
 */
export function jobIsPublic(job: { status: JobStatus }): boolean {
  return job.status === 'active' || job.status === 'expired' || job.status === 'closed';
}
