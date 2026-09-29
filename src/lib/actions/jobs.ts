'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';

import type { ActionResult } from '@/lib/action-result';

export type { ActionResult };

const jobIdSchema = z.string().uuid();

export async function toggleSavedJob(input: string): Promise<ActionResult<{ saved: boolean }>> {
  const id = jobIdSchema.safeParse(input);
  if (!id.success) return { ok: false, error: 'invalid' };
  const jobId = id.data;

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
    if (error) return failed('save', 'could not unsave a listing', error, { job: jobId });
    revalidatePath('/dashboard/saved');
    return { ok: true, data: { saved: false } };
  }

  const { error } = await supabase
    .from('saved_jobs')
    .insert({ job_id: jobId, candidate_id: user.id });
  // A listing that cannot be saved — a draft somebody guessed the id of, a
  // policy that said no — is answered the same way whatever the reason.
  if (error) return failed('save', 'could not save a listing', error, { job: jobId });

  revalidatePath('/dashboard/saved');
  return { ok: true, data: { saved: true } };
}

/**
 * Bumps the view counter.
 *
 * With the service role, on purpose. The function is closed to anon and
 * authenticated since migration 304 — a visitor could call it without limit,
 * and as it turned out could not call it at all, because guard_job_update
 * refuses a view_count change from anyone not acting as admin and every call
 * from a visitor's session had been raising into a discarded promise. The
 * page calls this after the response is on its way, so a slow count never
 * slows a reader.
 */
export async function recordJobView(slug: string): Promise<void> {
  if (!/^[a-z0-9-]{1,200}$/.test(slug)) return;
  try {
    const { error } = await createAdminClient().rpc('increment_job_view', { job_slug: slug });
    if (error) logFailure('jobs', 'view not counted', { slug, code: error.code });
  } catch {
    // No service role configured: the count is the one thing this page can do
    // without.
  }
}

/**
 * A database refusal, answered without the database's words.
 *
 * `error.message` carries constraint names, trigger names and hints — a map
 * of the schema, handed to whoever sent the request. The message goes to the
 * log with the identifiers that find the row; the caller gets a code.
 */
function failed(
  area: string,
  event: string,
  error: { code?: string | null; message: string },
  detail: Record<string, string | undefined>,
): { ok: false; error: string } {
  logFailure(area, event, { ...detail, code: error.code ?? undefined });
  return { ok: false, error: 'failed' };
}
