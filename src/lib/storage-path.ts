/**
 * What a storage path this app writes looks like, stated once.
 *
 * Every upload goes to `<owner id>/<uuid>.<ext>` — the owner's own folder,
 * one file, no deeper. Four server actions checked that with
 * `startsWith(`${id}/`)`, which is true of `<id>/../<somebody else>/cv.pdf`;
 * storage resolves the path as a URL and a URL collapses `..`, so the check
 * passed and the signed URL pointed at another person's file. The database
 * says the same thing as this since migration 202 (`applications_cv_is_the_applicants`,
 * `agent_profiles_cv_is_the_owners`); this is the same rule where the request
 * is first read.
 *
 * No imports, so the auth suite can load it under Node.
 */
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `<owner>/<file>` exactly: one folder named for the owner, one file in it. */
export function isOwnStoragePath(owner: string, path: string | null | undefined): boolean {
  if (!path || !owner) return false;
  const [folder, file, ...rest] = path.split('/');
  return rest.length === 0 && folder === owner && Boolean(file) && FILE.test(file);
}

/** A file name the browser is about to upload under, from the file it was given. */
export function safeExtension(fileName: string, fallback: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{1,8}$/.test(extension) ? extension : fallback;
}
