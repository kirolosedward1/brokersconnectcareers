import { EMPTY_FILTERS, serializeJobFilters, type JobFilters } from '@/lib/job-filters';
import type {
  AgentAvailability,
  AgentVisibility,
  CompanyType,
  DistrictRow,
  ExperienceBand,
  JobTrack,
  LeadsSource,
} from '@/lib/supabase/database.types';
import { uploadCv, type PickedCv } from '~/features/cv/files';
import { callAction } from '~/lib/api';
import { supabase } from '~/lib/supabase';

/**
 * What onboarding asks after the account itself, and where each answer goes
 * once the profile exists (completeOnboarding made it): the consultant's
 * directory card (saveAgentProfile, the profile form's own action), their
 * record (saveProfileRecord), their CV, and the jobs they want to hear about —
 * a saved search with alerts, the board's own filters, so the daily alert that
 * already exists sends them. A company's English name and kind go on the
 * company it just made (saveCompany).
 *
 * Each is its own write and each may fail on its own; the account is made by
 * then, so a failure is said ("finish it from your profile") rather than
 * holding the person on onboarding.
 */

export type LeadsChoice = 'company' | 'self' | 'either';

export type CandidateAnswers = {
  tracks: JobTrack[];
  band: ExperienceBand | null;
  districtIds: number[];
  /** One of MIN_SALARY_STEPS, or null for any. */
  minSalary: number | null;
  leads: LeadsChoice;
  cv: PickedCv | null;
  unitsClosed: number | null;
  availability: AgentAvailability;
  /** A saved search with these, alerts on. */
  alert: boolean;
};

/** The years a band begins at: what the profile stores, and the band it reads back as (match.ts, bandFor). */
export function yearsFor(band: ExperienceBand | null): number {
  switch (band) {
    case 'junior_1_3':
      return 1;
    case 'mid_3_5':
      return 3;
    case 'senior_5_plus':
      return 5;
    default:
      return 0;
  }
}

export function leadsSourcesFor(choice: LeadsChoice): LeadsSource[] {
  return choice === 'company' ? ['company_provided'] : choice === 'self' ? ['self_generated'] : [];
}

/** The board's filters these answers make: the tracks, the places, the pay floor and who brings the clients. */
export function answersFilters(answers: Pick<CandidateAnswers, 'tracks' | 'districtIds' | 'minSalary' | 'leads'>, districts: readonly DistrictRow[]): JobFilters {
  const slugs = answers.districtIds
    .map((id) => districts.find((district) => district.id === id)?.slug)
    .filter((slug): slug is string => Boolean(slug));
  return {
    ...EMPTY_FILTERS,
    tracks: answers.tracks,
    districtSlugs: slugs,
    minSalary: answers.minSalary,
    leadsSources: leadsSourcesFor(answers.leads),
  };
}

/** The query those filters are, as the board and a saved search write it. */
export function answersQuery(filters: JobFilters): string {
  return serializeJobFilters({ ...filters, page: 1 }).toString();
}

export type FinishOutcome = { complete: boolean };

/**
 * Everything a consultant answered, written onto the profile made a moment
 * ago. The headline and languages the new card was made with are kept.
 */
export async function finishCandidate(
  userId: string,
  /** Visibility null: the card's own, as chosen when it was made (guest apply). */
  base: { fullName: string; whatsapp: string; visibility: AgentVisibility | null },
  answers: CandidateAnswers,
  alertSearch: { label: string; query: string } | null,
): Promise<FinishOutcome> {
  let complete = true;
  const made = await supabase
    .from('agent_profiles')
    .select('id, headline_ar, headline_en, languages, visibility, tracks, district_ids, years_experience')
    .eq('user_id', userId)
    .maybeSingle();
  const row = (made.error ? null : made.data) as {
    id: string;
    headline_ar: string | null;
    headline_en: string | null;
    languages: string[] | null;
    visibility: AgentVisibility | null;
    tracks: JobTrack[] | null;
    district_ids: number[] | null;
    years_experience: number | null;
  } | null;
  const visibility = base.visibility ?? row?.visibility ?? null;
  // Without a choice to keep, the card is not touched: a visibility is never chosen for somebody.
  if (!row || !visibility) return { complete: false };
  // The card's developers go back as they are: the action replaces the whole list,
  // and a list that could not be read is not taken for none.
  const developers = await supabase.from('agent_developers').select('developer_id').eq('agent_id', row.id);
  if (developers.error) return { complete: false };
  const developerIds = (developers.data ?? []).map((link) => link.developer_id as number);

  const cvPath = answers.cv
    ? await uploadCv(userId, answers.cv).catch(() => {
        complete = false;
        return null;
      })
    : null;

  const profile = await callAction('saveAgentProfile', {
    fullName: base.fullName,
    whatsapp: base.whatsapp,
    headlineAr: row.headline_ar,
    headlineEn: row.headline_en,
    yearsExperience: answers.band ? yearsFor(answers.band) : (row.years_experience ?? 0),
    // A step passed over keeps what the card already says.
    tracks: answers.tracks.length ? answers.tracks : (row.tracks ?? []),
    districtIds: answers.districtIds.length ? answers.districtIds : (row.district_ids ?? []),
    developerIds,
    languages: row.languages ?? [],
    availability: answers.availability,
    visibility,
    ...(cvPath ? { cvPath } : {}),
  }).catch(() => null);
  if (!profile?.ok) complete = false;

  if (answers.unitsClosed != null) {
    const record = await callAction('saveProfileRecord', { unitsClosed: answers.unitsClosed }).catch(() => null);
    if (!record?.ok) complete = false;
  }

  if (answers.alert && alertSearch) {
    const saved = await callAction('saveSearch', alertSearch).catch(() => null);
    if (!saved?.ok) complete = false;
  }

  return { complete };
}

/** A company's English name and kind, on the company completeOnboarding made, at the version it was made at. */
export async function finishCompany(
  userId: string,
  fields: { nameAr: string; nameEn: string | null; website: string | null; companyType: CompanyType | null; districtId: number | null },
): Promise<FinishOutcome> {
  if (!fields.nameEn && !fields.companyType) return { complete: true };
  const made = await supabase.from('companies').select('id, version').eq('owner_id', userId).maybeSingle();
  const version = (made.data as { version?: number } | null)?.version;
  if (made.error || !version) return { complete: false };
  const saved = await callAction('saveCompany', { ...fields, version }).catch(() => null);
  return { complete: Boolean(saved?.ok) };
}
