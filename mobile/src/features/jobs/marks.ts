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
