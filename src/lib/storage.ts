import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export const CV_BUCKET = 'cvs';
export const COMPANY_DOCS_BUCKET = 'company-documents';
export const COMPANY_LOGOS_BUCKET = 'company-logos';

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
  const { data, error } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error) return null;
  return data.signedUrl;
}
