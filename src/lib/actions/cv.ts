'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { JOB_TRACKS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';

/**
 * The CV sections: work history, education, certifications.
 *
 * Every one of these runs through the caller's own session. The write policies
 * on all three tables require the row's profile to belong to `auth.uid()`, so
 * a forged `agentId` is refused by the database rather than by a check here —
 * which is what makes this file safe to be short.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date')
  .nullable()
  .optional();

const experienceSchema = z
  .object({
    id: z.string().uuid().optional(),
    agentId: z.string().uuid(),
    companyName: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(120),
    track: z.enum(JOB_TRACKS).nullable().optional(),
    districtId: z.number().int().positive().nullable().optional(),
    started: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ended: isoDate,
    highlights: z.string().trim().max(600).nullable().optional(),
  })
  .refine((v) => !v.ended || v.ended >= v.started, {
    message: 'ended_before_started',
    path: ['ended'],
  });

export async function saveExperience(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = experienceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', fieldErrors: flatten(parsed.error) };
  }

  const { id, agentId, companyName, title, track, districtId, started, ended, highlights } =
    parsed.data;

  const supabase = await createClient();
  const row = {
    agent_id: agentId,
    company_name: companyName,
    title,
    track: track ?? null,
    district_id: districtId ?? null,
    started,
    ended: ended || null,
    highlights: highlights?.trim() || null,
  };

  const query = id
    ? supabase.from('agent_experience').update(row).eq('id', id).select('id').single()
    : supabase.from('agent_experience').insert(row).select('id').single();

  const { data, error } = await query;
  if (error) return { ok: false, error: capMessage(error.message) };

  revalidatePath('/dashboard/profile');
  return { ok: true, data: { id: data.id } };
}

const educationSchema = z.object({
  id: z.string().uuid().optional(),
  agentId: z.string().uuid(),
  institution: z.string().trim().min(1).max(160),
  degree: z.string().trim().max(120).nullable().optional(),
  field: z.string().trim().max(120).nullable().optional(),
  graduated: z.number().int().min(1950).max(2100).nullable().optional(),
});

export async function saveEducation(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = educationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid', fieldErrors: flatten(parsed.error) };

  const { id, agentId, institution, degree, field, graduated } = parsed.data;

  const supabase = await createClient();
  const row = {
    agent_id: agentId,
    institution,
    degree: degree?.trim() || null,
    field: field?.trim() || null,
    graduated: graduated ?? null,
  };

  const query = id
    ? supabase.from('agent_education').update(row).eq('id', id).select('id').single()
    : supabase.from('agent_education').insert(row).select('id').single();

  const { data, error } = await query;
  if (error) return { ok: false, error: capMessage(error.message) };

  revalidatePath('/dashboard/profile');
  return { ok: true, data: { id: data.id } };
}

const certificationSchema = z
  .object({
    id: z.string().uuid().optional(),
    agentId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    issuer: z.string().trim().max(160).nullable().optional(),
    issued: isoDate,
    expires: isoDate,
  })
  .refine((v) => !v.expires || !v.issued || v.expires >= v.issued, {
    message: 'expires_before_issued',
    path: ['expires'],
  });

export async function saveCertification(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = certificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid', fieldErrors: flatten(parsed.error) };

  const { id, agentId, name, issuer, issued, expires } = parsed.data;

  const supabase = await createClient();
  const row = {
    agent_id: agentId,
    name,
    issuer: issuer?.trim() || null,
    issued: issued || null,
    expires: expires || null,
  };

  const query = id
    ? supabase.from('agent_certifications').update(row).eq('id', id).select('id').single()
    : supabase.from('agent_certifications').insert(row).select('id').single();

  const { data, error } = await query;
  if (error) return { ok: false, error: capMessage(error.message) };

  revalidatePath('/dashboard/profile');
  return { ok: true, data: { id: data.id } };
}

const SECTIONS = {
  experience: 'agent_experience',
  education: 'agent_education',
  certification: 'agent_certifications',
} as const;

export async function deleteCvEntry(
  section: keyof typeof SECTIONS,
  id: string,
): Promise<ActionResult> {
  if (!(section in SECTIONS)) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const { error } = await supabase.from(SECTIONS[section]).delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/profile');
  return { ok: true };
}

const recordSchema = z.object({
  summaryAr: z.string().trim().max(1200).nullable().optional(),
  unitsClosed: z.number().int().min(0).max(100000).nullable().optional(),
  volumeEgp: z.number().int().min(0).nullable().optional(),
});

/** The objective and the sales record, which live on the profile itself. */
export async function saveProfileRecord(input: unknown): Promise<ActionResult> {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase
    .from('agent_profiles')
    .update({
      summary_ar: parsed.data.summaryAr?.trim() || null,
      units_closed: parsed.data.unitsClosed ?? null,
      volume_egp: parsed.data.volumeEgp ?? null,
    })
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/profile');
  return { ok: true };
}

/** The cap is a database rule; say so in words the editor can show. */
function capMessage(message: string): string {
  return message.includes('cv_section_cap') ? 'cap' : message;
}

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !out[key]) out[key] = issue.message;
  }
  return out;
}
