import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';

// Re-exported so server-side callers keep one import for "storage things",
// while the names themselves stay reachable from the browser.
export { CV_BUCKET, COMPANY_DOCS_BUCKET, COMPANY_LOGOS_BUCKET } from '@/lib/buckets';

/**
 * Mints a short-lived signed URL with the service role.
 *
 * The caller is responsible for having already established that this viewer is
 * allowed to see this file — an employer who owns the job the CV was sent to,
 * a verified employer looking at an unlocked agent profile, or an admin. This
 * function does not authorise anything on its own.
 */
export async function signedUrl(
  bucket: string,
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  /*
    Null, never a throw. createAdminClient() throws while
    SUPABASE_SERVICE_ROLE_KEY is unset — production's state as of 27 Sep 2026
    — and every caller already treats null as "no link". Thrown, it took the
    whole consultant profile down for the one reader entitled to its CV, and
    turned the employer's "open CV" into an unhandled 500. The file stays
    unavailable until the key is set; the page around it does not have to.
  */
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    logFailure('storage', 'cannot sign a file URL without the service role', {
      bucket,
      detail: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }

  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresInSeconds);

  if (error) return null;
  return data.signedUrl;
}
