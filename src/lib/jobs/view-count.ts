import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';
import { allow, subject } from '@/lib/rate-limit';

/**
 * Counts one view of a listing — at most one per network address per listing
 * per hour.
 *
 * With the service role, on purpose. increment_job_view is closed to anon and
 * authenticated since migration 304 — a visitor could call it without limit,
 * and as it turned out could not call it at all, because guard_job_update
 * refuses a view_count change from anyone not acting as admin.
 *
 * The hourly allowance is what keeps that closure meaningful. recordJobView is
 * a public server action and a public action of the app's door, and without a
 * limit either one was the anon-callable counter 304 removed, one hop away: a
 * loop of signed-out requests raised the count shown on the listing and in
 * both consoles. A person reading a listing twice in an hour is one reader.
 *
 * `ip` is read by the caller during the request (headers() cannot be read
 * inside a page's after()), never taken from the request body.
 */
export async function countJobView(slug: string, ip: string): Promise<void> {
  if (!/^[a-z0-9-]{1,200}$/.test(slug)) return;
  if (!(await allow(`job_view:${subject('ip', ip)}:${slug}`, 1, 3600))) return;
  try {
    const { error } = await createAdminClient().rpc('increment_job_view', { job_slug: slug });
    if (error) logFailure('jobs', 'view not counted', { slug, code: error.code });
  } catch {
    // No service role configured: the count is the one thing a page can do
    // without.
  }
}
