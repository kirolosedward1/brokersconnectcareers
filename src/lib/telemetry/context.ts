/**
 * Which build is running, and where.
 *
 * Every captured error and every structured log line carries these two
 * values, because "did this start with the last deploy?" is the first question
 * anybody asks about a new failure — and without them it gets answered by
 * lining timestamps up against the deployment list by hand.
 *
 * Isomorphic on purpose: the browser reports the same release the server
 * does. NEXT_PUBLIC_* values are inlined when the bundle is built, and a build
 * *is* a release, so the value cannot drift from the code that is running. A
 * tab left open across a deploy keeps reporting the release it loaded, which
 * is exactly the correlation a ChunkLoadError after a deploy needs.
 *
 * Sources, in order: NEXT_PUBLIC_RELEASE (set by CI, or by hand for a local
 * build), then the commit Vercel exposes to every Next.js build, then — on the
 * server only — the runtime copy of the same commit.
 */

export type Environment = 'production' | 'preview' | 'development' | 'ci' | 'local';

const SHA = /^[0-9a-f]{12,40}$/i;

export function releaseId(): string {
  const raw =
    process.env.NEXT_PUBLIC_RELEASE ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    '';

  if (!raw) return 'dev';
  // A commit is shortened the way Vercel and GitHub print it, so the value in
  // an alert can be pasted straight into either. Anything else (a tag, a
  // build number) is kept as given.
  return SHA.test(raw) ? raw.slice(0, 7).toLowerCase() : raw.slice(0, 40);
}

/**
 * The deployment's environment.
 *
 * VERCEL_ENV is authoritative at runtime on the server. The browser only has
 * the build-time copy, which is the same value for every deployment except a
 * preview promoted to production without a rebuild — rare, and harmless here,
 * because the endpoint that receives browser reports overrides it with its own.
 */
export function environmentName(): Environment {
  const vercel = process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development') return vercel;
  if (process.env.NODE_ENV === 'development') return 'development';
  if (process.env.CI || process.env.NEXT_PUBLIC_CI) return 'ci';
  return 'local';
}
