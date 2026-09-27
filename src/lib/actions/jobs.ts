'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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

/**
 * Bumps the view counter through a SECURITY DEFINER function, so anonymous
 * visitors can be counted without being granted UPDATE on jobs.
 */
export async function recordJobView(slug: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('increment_job_view', { job_slug: slug });
}
