/**
 * What a consultant's profile is scored on, and by how much.
 *
 * The same eight tests and the same weights as `profile_completeness()` in
 * migration 12. There are two copies because neither side can call the other —
 * the percentage is computed in SQL so the dashboard can ask for it in one
 * round trip, and the list of what is missing is built in the browser from a
 * row it already has. The schema suite runs a profile through both and asserts
 * they agree, which is the same arrangement the Arabic normalisers have.
 *
 * Its own file, with no imports, so that suite can load it: the component this
 * used to live in pulls in next-intl and the whole server runtime.
 */
export type ProfileFacts = {
  summary_ar: string | null;
  headline_ar: string | null;
  tracks: unknown[] | null;
  district_ids: unknown[] | null;
  years_experience: number;
  units_closed: number | null;
  volume_egp: number | null;
  hasExperience: boolean;
  hasEducation: boolean;
};

export type ProfileGap = { key: string; points: number; missing: boolean };

/** In the order the product holds its opinion, biggest weight first. */
export function profileGaps(facts: ProfileFacts): ProfileGap[] {
  return [
    { key: 'summary', points: 20, missing: !facts.summary_ar?.trim() },
    { key: 'headline', points: 15, missing: !facts.headline_ar?.trim() },
    { key: 'experience', points: 15, missing: !facts.hasExperience },
    { key: 'tracks', points: 10, missing: !facts.tracks?.length },
    { key: 'districts', points: 10, missing: !facts.district_ids?.length },
    { key: 'years', points: 10, missing: !(facts.years_experience > 0) },
    { key: 'record', points: 10, missing: facts.units_closed == null && facts.volume_egp == null },
    { key: 'education', points: 10, missing: !facts.hasEducation },
  ];
}

/** The percentage the SQL function should return for the same row. */
export function completenessOf(facts: ProfileFacts): number {
  return profileGaps(facts)
    .filter((gap) => !gap.missing)
    .reduce((sum, gap) => sum + gap.points, 0);
}
