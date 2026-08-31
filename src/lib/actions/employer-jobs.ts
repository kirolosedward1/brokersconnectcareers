'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { buildJobSlug } from '@/lib/slug';
import { getDistricts } from '@/lib/queries/taxonomy';
import {
  BENEFITS,
  COMMISSION_TYPES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
} from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';

const jobSchema = z
  .object({
    id: z.string().uuid().optional(),
    titleAr: z.string().trim().min(3).max(160),
    titleEn: z.string().trim().max(160).optional().nullable(),
    track: z.enum(JOB_TRACKS),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    experienceBand: z.enum(EXPERIENCE_BANDS),
    seats: z.coerce.number().int().min(1).max(999),
    districtId: z.coerce.number().int().positive(),
    basicSalaryMin: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
    basicSalaryMax: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
    commissionType: z.enum(COMMISSION_TYPES),
    commissionValue: z.coerce.number().min(0).max(100).nullable().optional(),
    commissionNoteAr: z.string().trim().max(500).optional().nullable(),
    leadsSource: z.enum(LEADS_SOURCES),
    benefits: z.array(z.enum(BENEFITS)).max(5),
    descriptionAr: z.string().trim().min(20).max(8000),
    descriptionEn: z.string().trim().max(8000).optional().nullable(),
    requirementsAr: z.string().trim().max(4000).optional().nullable(),
    developerIds: z.array(z.coerce.number().int().positive()).max(30),
    submit: z.boolean(),
  })
  .refine(
    (value) =>
      value.basicSalaryMin == null ||
      value.basicSalaryMax == null ||
      value.basicSalaryMax >= value.basicSalaryMin,
    { path: ['basicSalaryMax'], message: 'salaryOrder' },
  )
  .refine(
    (value) => value.commissionType !== 'percentage' || value.commissionValue != null,
    { path: ['commissionValue'], message: 'commissionRequired' },
  );

/**
 * Creates or updates a listing. An employer can save a draft or submit for
 * review; publishing is a moderation action and is refused at the database
 * level for anyone who is not an admin.
 */
export async function saveJob(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message || 'required';
    }
    return { ok: false, error: 'invalid', fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: company } = await supabase
    .from('companies')
    .select('id, name_ar, name_en')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!company) return { ok: false, error: 'no_company' };

  const value = parsed.data;
  const status = value.submit ? 'pending_review' : 'draft';

  const payload = {
    title_ar: value.titleAr,
    title_en: value.titleEn || null,
    track: value.track,
    employment_type: value.employmentType,
    experience_band: value.experienceBand,
    seats: value.seats,
    district_id: value.districtId,
    basic_salary_min: value.basicSalaryMin ?? null,
    basic_salary_max: value.basicSalaryMax ?? null,
    commission_type: value.commissionType,
    // The database rejects a value on any type other than percentage, so drop
    // whatever a stale form field left behind.
    commission_value: value.commissionType === 'percentage' ? (value.commissionValue ?? null) : null,
    commission_note_ar: value.commissionNoteAr || null,
    leads_source: value.leadsSource,
    benefits: value.benefits,
    description_ar: value.descriptionAr,
    description_en: value.descriptionEn || null,
    requirements_ar: value.requirementsAr || null,
    status,
  } as const;

  let jobId = value.id;

  if (jobId) {
    const { error } = await supabase.from('jobs').update(payload).eq('id', jobId);
    if (error) return { ok: false, error: mapJobError(error.message) };
  } else {
    const districts = await getDistricts();
    const district = districts.find((d) => d.id === value.districtId);

    const { data, error } = await supabase
      .from('jobs')
      .insert({
        company_id: company.id,
        slug: buildJobSlug(value.titleEn || value.titleAr, district?.slug ?? 'egypt'),
        ...payload,
      })
      .select('id')
      .single();

    if (error) return { ok: false, error: mapJobError(error.message) };
    jobId = data.id;
  }

  await supabase.from('job_developers').delete().eq('job_id', jobId);
  if (value.developerIds.length) {
    await supabase
      .from('job_developers')
      .insert(value.developerIds.map((developerId) => ({ job_id: jobId!, developer_id: developerId })));
  }

  revalidatePath('/employer/jobs');
  return { ok: true, data: { id: jobId! } };
}

const transitionSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['draft', 'pending_review', 'closed']),
});

/**
 * The transitions an employer is allowed to make. `active` is deliberately not
 * on this list — guard_job_update() in the database refuses it regardless.
 */
export async function transitionJob(input: unknown): Promise<ActionResult> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('jobs')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.jobId);

  if (error) return { ok: false, error: mapJobError(error.message) };

  revalidatePath('/employer/jobs');
  return { ok: true };
}

/** Turns database-level rule violations into something the UI can explain. */
function mapJobError(message: string): string {
  if (message.includes('unverified_company_post_cap')) return 'post_cap';
  if (message.includes('job status cannot go from')) return 'invalid_transition';
  return message;
}
