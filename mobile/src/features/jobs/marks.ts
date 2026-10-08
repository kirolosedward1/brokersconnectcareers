import { useMemo } from 'react';
import { useMyApplications } from '~/features/applications/queries';

/**
 * Which listings on screen this reader has already applied to — the board's
 * "applied" badge.
 *
 * From the candidate's own applications, which the app reads anyway (Home,
 * the Applications tab) and reads again after every application and
 * withdrawal. Asked per page of the board instead, keyed on every id loaded so
 * far, the badges went blank while each new page's question was answered and
 * the question grew by a listing's id for every listing scrolled past. Nobody
 * who is not a candidate has an answer to give: empty.
 */
export function useAppliedJobIds(jobIds: string[]): Set<string> {
  const { data } = useMyApplications();
  return useMemo(() => {
    const mine = new Set((data ?? []).map((application) => application.job_id));
    return new Set(jobIds.filter((id) => mine.has(id)));
  }, [data, jobIds]);
}

/**
 * A list of listings with the ones already applied to moved to its foot, in
 * their own order: what is still to decide comes first. Applying again is not
 * possible, so an applied listing at the top of a list was a listing in the way.
 */
export function appliedLast<T extends { id: string }>(jobs: T[], applied: Set<string>): T[] {
  if (!applied.size) return jobs;
  return [...jobs.filter((job) => !applied.has(job.id)), ...jobs.filter((job) => applied.has(job.id))];
}

/** A list in that order, with which of it are applied to, for the cards' badges. */
export function useAppliedLast<T extends { id: string }>(jobs: T[]): { jobs: T[]; applied: Set<string> } {
  const ids = useMemo(() => jobs.map((job) => job.id), [jobs]);
  const applied = useAppliedJobIds(ids);
  return useMemo(() => ({ jobs: appliedLast(jobs, applied), applied }), [jobs, applied]);
}
