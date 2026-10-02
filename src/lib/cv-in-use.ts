/*
  No server imports: the CV actions pass in the reads they make with the
  caller's own session, and scripts/cv-in-use.test.mjs passes in fakes.
*/

type Answer<T> = PromiseLike<{ data: T | null; error: unknown }>;

/** What applyToJob and saveAgentProfile read, through the caller's session. */
export type CvReads = {
  /** The caller's directory profile, for its CV. */
  profileCv(): Answer<{ cv_path: string | null }>;
  /** The caller's applications sent with this file, if any. */
  applicationsWith(path: string): Answer<{ id: string }[]>;
};

/**
 * Whether a CV path is a file the caller's own rows already point at: their
 * profile's CV, or one an application went out with.
 *
 * The bytes check deletes a file that is not a document. That is right for
 * one just uploaded and wrong for one in use: the app attaches the profile's
 * CV by default, and a file stored before the check existed — or while it
 * could not run — refused now, was taken out from under the profile and every
 * application that carried it. A read that failed is an unknown, and an
 * unknown counts as in use: keeping a file costs a day in the bucket, before
 * the clean-up takes what nothing points at; deleting one costs somebody
 * their CV.
 */
export async function cvInUse(reads: CvReads, path: string): Promise<boolean> {
  const [profile, applications] = await Promise.all([reads.profileCv(), reads.applicationsWith(path)]);
  if (profile.error || applications.error) return true;
  return profile.data?.cv_path === path || (applications.data?.length ?? 0) > 0;
}
