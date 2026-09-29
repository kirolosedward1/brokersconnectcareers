import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobInput } from '@/lib/mobile-api/contract';
import { canAccessEmployerArea } from '@/lib/permissions';
import type {
  Benefit,
  CommissionType,
  EmploymentType,
  ExperienceBand,
  JobRow,
  JobTrack,
  LeadsSource,
  SalaryReferenceRow,
} from '@/lib/supabase/database.types';
import { westernDigits } from '@/lib/search/arabic';
import { wholeNumber } from '~/components/profile/fields';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The job wizard's data — the website's JobForm on the phone: the listing to
 * edit (the company's own, read with the version the save is matched on),
 * the two questions asked on leaving the first step, and saveJob.
 */

/** What the form holds while it is being filled in: text as typed, choices as chosen. */
export type JobValues = {
  titleAr: string;
  titleEn: string;
  track: JobTrack;
  employmentType: EmploymentType;
  experienceBand: ExperienceBand;
  seats: string;
  districtId: number | null;
  basicSalaryMin: string;
  basicSalaryMax: string;
  commissionType: CommissionType;
  commissionValue: string;
  commissionNoteAr: string;
  leadsSource: LeadsSource;
  benefits: Benefit[];
  descriptionAr: string;
  descriptionEn: string;
  requirementsAr: string;
  developerIds: number[];
};

/** The website's defaults for a new listing, and a stored one as the form shows it. */
export function initialValues(job: JobRow | null, developerIds: number[], firstDistrict: number | null): JobValues {
  return {
    titleAr: job?.title_ar ?? '',
    titleEn: job?.title_en ?? '',
    track: job?.track ?? 'primary',
    employmentType: job?.employment_type ?? 'full_time',
    experienceBand: job?.experience_band ?? 'junior_1_3',
    seats: String(job?.seats ?? 1),
    districtId: job?.district_id ?? firstDistrict,
    basicSalaryMin: job?.basic_salary_min != null ? String(job.basic_salary_min) : '',
    basicSalaryMax: job?.basic_salary_max != null ? String(job.basic_salary_max) : '',
    commissionType: job?.commission_type ?? 'percentage',
    commissionValue: job?.commission_value != null ? String(job.commission_value) : '',
    commissionNoteAr: job?.commission_note_ar ?? '',
    leadsSource: job?.leads_source ?? 'company_provided',
    benefits: (job?.benefits as Benefit[] | undefined) ?? [],
    descriptionAr: job?.description_ar ?? '',
    descriptionEn: job?.description_en ?? '',
    requirementsAr: job?.requirements_ar ?? '',
    developerIds,
  };
}

/** A number with a fraction — typed with either set of digits, and either decimal mark. */
export function decimalNumber(text: string): number | null {
  const value = westernDigits(text).replace(/\s/g, '').replace(/[٫,]/g, '.');
  if (!value) return null;
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

export type FieldKey = keyof JobValues | 'form';

/** The steps, and which fields each holds — a refusal about a field sends the reader back to its step. */
export const STEPS = ['basics', 'compensation', 'details', 'review'] as const;
const STEP_OF: Partial<Record<FieldKey, number>> = {
  titleAr: 0,
  titleEn: 0,
  seats: 0,
  districtId: 0,
  basicSalaryMin: 1,
  basicSalaryMax: 1,
  commissionValue: 1,
  commissionNoteAr: 1,
  descriptionAr: 2,
  descriptionEn: 2,
  requirementsAr: 2,
};

export function stepOf(fields: readonly string[]): number | null {
  const steps = fields.map((field) => STEP_OF[field as FieldKey]).filter((step): step is number => step != null);
  return steps.length ? Math.min(...steps) : null;
}

/** Validation message keys, as the website's schema names them. */
export type Problem = 'required' | 'salaryOrder' | 'commissionRequired' | 'tooManyLinks' | 'numberInvalid';

/**
 * What the server's schema would refuse on one step, checked before anything
 * is sent — the website's `required` attributes and the refinements behind
 * them: a title (three letters at least), a seat count, the salary as whole
 * pounds with the ceiling above the floor, a commission percentage when the
 * commission is one, and a description of twenty characters.
 */
export function problemsOn(step: number, values: JobValues): Partial<Record<FieldKey, Problem>> {
  const problems: Partial<Record<FieldKey, Problem>> = {};
  if (step === 0) {
    if (values.titleAr.trim().length < 3) problems.titleAr = 'required';
    const seats = wholeNumber(values.seats);
    if (seats === null || !Number.isInteger(seats) || seats < 1 || seats > 999) problems.seats = 'required';
    if (values.districtId == null) problems.districtId = 'required';
  }
  if (step === 1) {
    const min = wholeNumber(values.basicSalaryMin);
    const max = wholeNumber(values.basicSalaryMax);
    if (min !== null && (Number.isNaN(min) || min > 10_000_000)) problems.basicSalaryMin = 'numberInvalid';
    if (max !== null && (Number.isNaN(max) || max > 10_000_000)) problems.basicSalaryMax = 'numberInvalid';
    else if (min !== null && max !== null && !Number.isNaN(min) && max < min) problems.basicSalaryMax = 'salaryOrder';
    if (values.commissionType === 'percentage') {
      const value = decimalNumber(values.commissionValue);
      if (value === null || Number.isNaN(value) || value > 100) problems.commissionValue = 'commissionRequired';
    }
  }
  if (step === 2 && values.descriptionAr.trim().length < 20) problems.descriptionAr = 'required';
  return problems;
}

/** The action's input: the form's text trimmed, numbers read, empty as null. */
export function toJobInput(
  values: JobValues,
  extras: { id?: string; version?: number; idempotencyKey: string; submit: boolean },
): JobInput {
  const orNull = (text: string) => text.trim() || null;
  const amount = (text: string) => {
    const value = wholeNumber(text);
    return value === null || Number.isNaN(value) ? null : value;
  };
  const commission = decimalNumber(values.commissionValue);
  return {
    ...(extras.id ? { id: extras.id } : {}),
    ...(extras.version ? { version: extras.version } : {}),
    idempotencyKey: extras.idempotencyKey,
    titleAr: values.titleAr.trim(),
    titleEn: orNull(values.titleEn),
    track: values.track,
    employmentType: values.employmentType,
    experienceBand: values.experienceBand,
    seats: amount(values.seats) ?? 0,
    districtId: values.districtId ?? 0,
    basicSalaryMin: amount(values.basicSalaryMin),
    basicSalaryMax: amount(values.basicSalaryMax),
    commissionType: values.commissionType,
    commissionValue: values.commissionType === 'percentage' && commission !== null && !Number.isNaN(commission) ? commission : null,
    commissionNoteAr: orNull(values.commissionNoteAr),
    leadsSource: values.leadsSource,
    benefits: values.benefits,
    descriptionAr: values.descriptionAr.trim(),
    descriptionEn: orNull(values.descriptionEn),
    requirementsAr: orNull(values.requirementsAr),
    developerIds: values.developerIds,
    submit: extras.submit,
  };
}

/**
 * One of the company's own listings to edit, with its developers. Null when
 * it is not the company's (or not there): the screen says not found.
 */
export function useEditableJob(id: string) {
  const { viewer, actor } = useSession();
  const companyId = canAccessEmployerArea(actor) ? (viewer?.company?.id ?? null) : null;
  return useQuery({
    queryKey: ['employer', 'job', id, companyId],
    enabled: Boolean(companyId && id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', id)
        .eq('company_id', companyId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { data: developers, error: developersError } = await supabase
        .from('job_developers')
        .select('developer_id')
        .eq('job_id', id);
      if (developersError) throw developersError;
      return { job: data as JobRow, developerIds: (developers ?? []).map((row) => row.developer_id as number) };
    },
  });
}

/** A listing the company already has that reads like this one; null when none, or unknown. */
export async function findSimilar(input: {
  titleAr: string;
  districtId: number;
  excludeId?: string | null;
}): Promise<{ id: string; title: string; seats: number } | null> {
  try {
    const result = await callAction('findSimilarListing', input);
    return result.ok ? (result.data?.match ?? null) : null;
  } catch {
    return null;
  }
}

/** What listings like this one pay — null below five live ones in the bucket, or when it cannot be had. */
export async function salaryReference(input: { track: JobTrack; districtId: number }): Promise<SalaryReferenceRow | null> {
  try {
    const result = await callAction('salaryReferenceFor', input);
    return result.ok ? (result.data?.reference ?? null) : null;
  } catch {
    return null;
  }
}

/** A refusal: a code the wizard has words for, and the fields the schema named. */
export class JobSaveRefused extends Error {
  constructor(
    readonly reason: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(reason);
    this.name = 'JobSaveRefused';
  }
}

export function useSaveJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: JobInput) => {
      const result = await callAction('saveJob', input);
      if (!result.ok) throw new JobSaveRefused(result.error, result.fieldErrors);
      return result.data?.id ?? null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employer'] }),
  });
}
