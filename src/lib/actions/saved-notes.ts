'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jobIsLive } from '@/lib/job-state';
import { logFailure } from '@/lib/observe';
import type { JobStatus } from '@/lib/supabase/database.types';
import type { ActionResult } from '@/lib/action-result';

/*
  When the app reminds the candidate before a saved listing closes
  (saved_jobs.remind_at, migration 366). The note on the same bookmark
  already lives there (migration 356, setSavedJobNote in actions/jobs.ts).

  The phone works out the moment (the day before the closing, ten in the
  morning in Cairo) and schedules its own notification from what this keeps.
  Here it is held to be still to come, within two years, and before a listing
  that is still open closes (`closing` otherwise). The trigger underneath
  says the same when the value is set or changed. Taking the bookmark off
  (toggleSavedJob) deletes the reminder with the row.

  The update is the caller's own row; RLS (saved_jobs_owner_update, migration
  356) and guard_saved_job_update say so again underneath. A listing that is
  not saved is `not_saved`.
*/

const reminderSchema = z.object({
  jobId: z.string().uuid(),
  /** When to remind, as an ISO timestamp; null takes the reminder away. */
  remindAt: z.string().datetime({ offset: true }).nullable(),
});

/**
 * Sets when the app reminds the candidate before a saved listing closes, or —
 * given null — takes the reminder away.
 */
export async function setSavedJobReminder(input: unknown): Promise<ActionResult<{ remindAt: string | null }>> {
  const parsed = reminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { jobId } = parsed.data;
  const at = parsed.data.remindAt ? new Date(parsed.data.remindAt) : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  if (at) {
    const { data: saved, error } = await supabase
      .from('saved_jobs')
      .select('job:jobs!inner (status, expires_at)')
      .eq('candidate_id', user.id)
      .eq('job_id', jobId)
      .maybeSingle();
    if (error) return failed('reminder not read', error, jobId);
    if (!saved) return { ok: false, error: 'not_saved' };
    const job = (saved as unknown as { job: { status: JobStatus; expires_at: string | null } }).job;
    const closes = job.expires_at ? new Date(job.expires_at).getTime() : null;
    const twoYears = new Date(Date.now());
    twoYears.setUTCFullYear(twoYears.getUTCFullYear() + 2);
    if (
      at.getTime() <= Date.now() ||
      at.getTime() > twoYears.getTime() ||
      !jobIsLive(job) ||
      (closes !== null && at.getTime() >= closes)
    ) {
      return { ok: false, error: 'closing' };
    }
  }

  const remindAt = at ? at.toISOString() : null;
  const { data: changed, error } = await supabase
    .from('saved_jobs')
    .update({ remind_at: remindAt })
    .eq('candidate_id', user.id)
    .eq('job_id', jobId)
    .select('job_id');

  if (error) return failed('reminder not kept', error, jobId);
  if (!changed?.length) return { ok: false, error: 'not_saved' };

  revalidatePath('/dashboard/saved');
  return { ok: true, data: { remindAt } };
}

/** A database refusal, answered without the database's words (as actions/jobs.ts does). */
function failed(event: string, error: { code?: string | null }, jobId: string): { ok: false; error: string } {
  logFailure('save', event, { job: jobId, code: error.code ?? undefined });
  return { ok: false, error: 'failed' };
}
