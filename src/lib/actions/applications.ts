'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { normalisePhone, isValidPhone } from '@/lib/phone';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';
import {
  notifyCandidateOfStatus,
  notifyEmployerOfApplication,
} from '@/lib/email/notify';
import type { ApplicationStatus, ExperienceBand } from '@/lib/supabase/database.types';

const applySchema = z.object({
  jobId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(6).max(24),
  experienceBand: z.enum(EXPERIENCE_BANDS),
  cvPath: z.string().trim().max(512).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * Apply in under 60 seconds: name, WhatsApp, experience band. The CV is
 * optional and there is no cover letter field, by design.
 */
export async function applyToJob(input: unknown): Promise<ActionResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const phone = normalisePhone(parsed.data.whatsapp);
  if (!isValidPhone(phone)) {
    return { ok: false, error: 'invalid', fieldErrors: { whatsapp: 'invalidPhone' } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // A CV path must sit under the applicant's own folder. Without this check a
  // crafted request could attach someone else's file to an application.
  if (parsed.data.cvPath && !parsed.data.cvPath.startsWith(`${user.id}/`)) {
    return { ok: false, error: 'invalid_cv_path' };
  }

  // Applying is also the moment people correct a stale phone number.
  await supabase
    .from('profiles')
    .update({ full_name: parsed.data.fullName, whatsapp_phone: phone })
    .eq('id', user.id);

  const { data: created, error } = await supabase
    .from('applications')
    .insert({
      job_id: parsed.data.jobId,
      candidate_id: user.id,
      experience_band: parsed.data.experienceBand as ExperienceBand,
      cv_path: parsed.data.cvPath || null,
      note: parsed.data.note || null,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'already_applied' };
    return { ok: false, error: error.message };
  }

  // after() runs once the response is on its way, so the applicant is not kept
  // waiting on an SMTP round trip — and a mail failure cannot turn a recorded
  // application into an error on their screen.
  if (created) after(() => notifyEmployerOfApplication(created.id));

  revalidatePath('/dashboard/applications');
  return { ok: true };
}

export async function withdrawApplication(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('applications').delete().eq('id', applicationId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/applications');
  return { ok: true };
}

const statusSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(['new', 'shortlisted', 'interview', 'hired', 'rejected']),
  /** Optional, and deliberately so — a required field becomes "not a fit" forever. */
  decisionNote: z.string().trim().max(500).optional().nullable(),
});

/** Employer pipeline move. RLS restricts this to jobs the caller owns. */
export async function setApplicationStatus(input: unknown): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('applications')
    .update({
      status: parsed.data.status as ApplicationStatus,
      employer_viewed_at: new Date().toISOString(),
      decision_note: parsed.data.decisionNote?.trim() || null,
    })
    .eq('id', parsed.data.applicationId);

  if (error) return { ok: false, error: error.message };

  after(() => notifyCandidateOfStatus(parsed.data.applicationId));

  revalidatePath('/employer/jobs');
  revalidatePath('/dashboard/applications');
  return { ok: true };
}
