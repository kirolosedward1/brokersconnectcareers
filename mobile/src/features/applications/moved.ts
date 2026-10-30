import { useEffect, useMemo } from 'react';
import { APPLICATION_STAGES } from '@/lib/application-stages';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { useMyApplications, type CandidateApplication } from '~/features/applications/queries';
import { useListOwner } from '~/features/jobs/recent';
import { createLocalList } from '~/lib/local-list';

/**
 * "A stage actually changed": the Applications tab's badge.
 *
 * The database keeps no time an application last moved, so what is
 * remembered is the stage each application was at when this person last had
 * the Applications screen in view. An application whose stage differs from
 * that has moved since: shortlisted, invited to interview, hired, declined.
 * Nothing else wears the badge — not a new application of their own, not
 * one being opened by the company, not their own withdrawal — and nothing
 * shows before the screen has been seen once on this phone, so a first
 * launch does not light up every application ever made.
 *
 * Kept on this phone, per person (src/lib/local-list.ts), as one entry.
 */
type Seen = { at: 'stages'; stages: Record<string, ApplicationStatus> };

const STATUSES = new Set<string>(APPLICATION_STAGES);

const seen = createLocalList<Seen>('bc.application-stages.v1', {
  max: 1,
  idOf: () => 'stages',
  valid: (item): item is Seen => {
    const stages = (item as Seen | null)?.stages;
    return (
      (item as Seen | null)?.at === 'stages' &&
      typeof stages === 'object' &&
      stages !== null &&
      Object.values(stages).every((status) => STATUSES.has(status as string))
    );
  },
});

type Standing = Pick<CandidateApplication, 'id' | 'status'>;

/**
 * How many of these applications moved since `stages` was written: a stage
 * other than the one seen, or — for one made since — any stage past "new".
 * A withdrawal is the candidate's own doing, not news. None before anything
 * was seen.
 */
export function countMoved(applications: readonly Standing[], stages: Record<string, ApplicationStatus> | null): number {
  if (!stages) return 0;
  return applications.filter((application) => {
    if (application.status === 'withdrawn') return false;
    const was = stages[application.id];
    return was === undefined ? application.status !== 'new' : was !== application.status;
  }).length;
}

/** The badge's count, from the applications already read (the board's "applied" marks read them too). */
export function useApplicationsMovedBadge(): number {
  const owner = useListOwner();
  const stages = seen.useItems(owner)[0]?.stages ?? null;
  const { data } = useMyApplications();
  return useMemo(() => countMoved(data ?? [], stages), [data, stages]);
}

/**
 * While the Applications screen is in view, every application's stage as it
 * now stands is the one seen: the badge goes, and comes back only for a
 * later move.
 */
export function useMarkStagesSeen(applications: readonly Standing[] | undefined, inView: boolean) {
  const owner = useListOwner();
  useEffect(() => {
    if (!inView || !applications) return;
    const stages: Record<string, ApplicationStatus> = {};
    for (const application of applications) stages[application.id] = application.status;
    seen.add(owner, { at: 'stages', stages });
  }, [owner, applications, inView]);
}

/** For tests: forget what each person saw. */
export function resetStagesSeenForTests() {
  seen.resetForTests();
}
