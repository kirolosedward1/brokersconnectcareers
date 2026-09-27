'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { REPORT_REASONS } from '@/lib/taxonomy';
import { clean } from '@/lib/security/sanitize';
import { logFailure } from '@/lib/observe';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

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
    detail: clean(parsed.data.detail, true) || null,
  });

  if (error) {
    if (error.message.includes('report_rate_limit')) return { ok: false, error: 'rate_limit' };
    // The unique index on (job_id, reporter_id).
    if (error.code === '23505') return { ok: false, error: 'already_reported' };
    return failed('report', 'report refused', error, { job: parsed.data.jobId });
  }

  return { ok: true };
}

/**
 * Bumps the view counter.
 *
 * With the service role, on purpose. The function is closed to anon and
 * authenticated since migration 69 — a visitor could call it without limit,
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
