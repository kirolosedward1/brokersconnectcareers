import { MAX_MATCH_SCORE, scoreJob, type MatchableJob, type MatchReasons } from '@/lib/match';
import { completeEnoughToMatch } from '~/features/dashboard/candidate';
import { useAgentProfile, useCandidateSummary } from '~/features/profile/queries';

export type JobMatch = { percent: number; reasons: MatchReasons };

/** A score as the share of what the profile could match, in tens: 2 of 5 points is 40%. */
export function matchPercent(score: number): number {
  return Math.round((score / MAX_MATCH_SCORE) * 100);
}

/**
 * How well a listing fits the signed-in candidate, by the website's own
 * scoring (src/lib/match.ts): their tracks, districts and years against the
 * listing's. Null for anybody else, for a profile that names no track and no
 * district (nothing to match on, so no number pretends to mean something),
 * for a listing that matches on nothing — a card says a fit, never a misfit —
 * and while the profile is under 60% complete (v1.1): a percentage scored on
 * a profile that says little would claim more than it knows.
 */
export function useJobMatch(): (job: MatchableJob) => JobMatch | null {
  const agent = useAgentProfile().data?.agent ?? null;
  const complete = completeEnoughToMatch(useCandidateSummary().data?.profile_completeness);
  return (job: MatchableJob) => (complete ? matchFor(job, agent) : null);
}

/** The fit itself, for a profile row (or none). */
export function matchFor(
  job: MatchableJob,
  agent: { tracks: MatchableJob['track'][] | null; district_ids: number[] | null; years_experience: number | null } | null,
): JobMatch | null {
  if (!agent || !(agent.tracks?.length || agent.district_ids?.length)) return null;
  const { score, reasons } = scoreJob(job, { tracks: agent.tracks, districtIds: agent.district_ids, yearsExperience: agent.years_experience });
  return score > 0 ? { percent: matchPercent(score), reasons } : null;
}
