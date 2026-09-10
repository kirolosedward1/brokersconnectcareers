import type { ExperienceBand, JobTrack } from '@/lib/supabase/database.types';

/**
 * Ordering open roles by how well they fit a consultant, and saying why.
 *
 * The dashboard used to show the three newest listings, with a comment giving
 * a good reason: on a board this size, *filtering* to somebody's own tracks and
 * districts mostly returns nothing, and "nothing for you" is a worse answer
 * than "here is what is open".
 *
 * That reason argues against filtering, not against ranking. Ranking never
 * empties the list — every listing still appears, in a different order — so the
 * objection disappears and the candidate gets their own board first.
 *
 * Every point is something the consultant typed into their own profile and
 * something the employer typed into the listing. Nothing is inferred, weighted
 * by a model, or invented: `reasons` carries the matched values back out so the
 * card can name them, because a recommendation a reader cannot check is a
 * recommendation they are entitled to distrust.
 *
 * A profile with no tracks and no districts scores every listing zero, which
 * leaves the newest-first order untouched. That is the correct outcome for
 * somebody who has told us nothing — and the caller can see it in
 * `personalised` and offer to fix the cause rather than silently pretending
 * the order means something.
 */

export type MatchProfile = {
  tracks: JobTrack[] | null;
  districtIds: number[] | null;
  yearsExperience: number | null;
};

export type MatchableJob = {
  track: JobTrack;
  district_id: number;
  experience_band: ExperienceBand;
};

export type MatchReasons = {
  /** The consultant's own track, as stated on their profile. */
  track: JobTrack | null;
  /** The district id both sides named — the caller resolves it to a name. */
  districtId: number | null;
  /** Their years fall inside the band the listing asks for. */
  experience: boolean;
};

/**
 * Which band a number of years falls into.
 *
 * The boundaries are read off the labels the product already shows — 0-1, 1-3,
 * 3-5, 5+ — so the match agrees with what a reader sees rather than with a
 * second opinion invented here. Overlapping edges resolve upward: three years
 * of experience answers a "1 – 3" listing and a "3 – 5" one, and counting it
 * for the higher of the two is the reading that flatters nobody falsely.
 */
export function bandFor(years: number): ExperienceBand {
  if (years >= 5) return 'senior_5_plus';
  if (years >= 3) return 'mid_3_5';
  if (years >= 1) return 'junior_1_3';
  return 'fresh_0_1';
}

/** Track and district are what a consultant actually searches by; experience breaks ties. */
const WEIGHT = { track: 2, district: 2, experience: 1 } as const;

export function scoreJob(
  job: MatchableJob,
  profile: MatchProfile,
): { score: number; reasons: MatchReasons } {
  const tracks = profile.tracks ?? [];
  const districts = profile.districtIds ?? [];

  const track = tracks.includes(job.track) ? job.track : null;
  const districtId = districts.includes(job.district_id) ? job.district_id : null;
  const experience =
    profile.yearsExperience != null && bandFor(profile.yearsExperience) === job.experience_band;

  const score =
    (track ? WEIGHT.track : 0) +
    (districtId ? WEIGHT.district : 0) +
    (experience ? WEIGHT.experience : 0);

  return { score, reasons: { track, districtId, experience } };
}

/**
 * The listings, best fit first.
 *
 * A stable sort, and the input arrives newest-first, so equal scores keep their
 * original order — which means an unfilled profile produces exactly the list
 * this page showed before, rather than an arbitrary shuffle that looks like
 * personalisation and is not.
 */
export function rankJobs<T extends MatchableJob>(
  jobs: readonly T[],
  profile: MatchProfile,
): { ranked: { job: T; score: number; reasons: MatchReasons }[]; personalised: boolean } {
  const personalised = Boolean(profile.tracks?.length || profile.districtIds?.length);

  const ranked = jobs
    .map((job) => ({ job, ...scoreJob(job, profile) }))
    .sort((a, b) => b.score - a.score);

  return { ranked, personalised };
}
