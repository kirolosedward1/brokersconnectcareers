'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { REPORT_REASONS } from '@/lib/taxonomy';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function toggleSavedJob(jobId: string): Promise<ActionResult<{ saved: boolean }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: existing } = await supabase
    .from('saved_jobs')
    .select('job_id')
    .eq('job_id', jobId)
    .eq('candidate_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('saved_jobs')
      .delete()
      .eq('job_id', jobId)
      .eq('candidate_id', user.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/dashboard/saved');
    return { ok: true, data: { saved: false } };
  }

  const { error } = await supabase
    .from('saved_jobs')
    .insert({ job_id: jobId, candidate_id: user.id });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/saved');
  return { ok: true, data: { saved: true } };
}

const reportSchema = z.object({
  jobId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  detail: z.string().trim().max(1000).optional(),
});

/**
 * Reporting is something an account does.
 *
 * It used to accept `reporter_id: null`, which read as friendlier and was
 * unworkable: nobody to rate-limit, nobody to ask a follow-up question, and
 * nobody who can be wrong twice. The queue those rows land in is read by a
 * person, which is exactly what makes it worth flooding.
 *
 * The distinct outcomes are named rather than collapsed into one failure,
 * because "you already reported this" and "something went wrong" ask the
 * reader for completely different next steps.
 */
export async function reportJob(input: unknown): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.from('reports').insert({
    job_id: parsed.data.jobId,
    reporter_id: user.id,
    reason: parsed.data.reason,
    detail: parsed.data.detail || null,
  });

  if (error) {
    if (error.message.includes('report_rate_limit')) return { ok: false, error: 'rate_limit' };
    // The unique index on (job_id, reporter_id).
    if (error.code === '23505') return { ok: false, error: 'already_reported' };
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * Bumps the view counter through a SECURITY DEFINER function, so anonymous
 * visitors can be counted without being granted UPDATE on jobs.
 */
export async function recordJobView(slug: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('increment_job_view', { job_slug: slug });
}
