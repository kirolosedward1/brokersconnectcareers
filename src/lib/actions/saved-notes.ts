'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jobIsLive } from '@/lib/job-state';
import { logFailure } from '@/lib/observe';
import { SAVED_NOTE_MAX } from '@/lib/saved-note';
import type { JobStatus } from '@/lib/supabase/database.types';
import type { ActionResult } from '@/lib/action-result';

/*
  The note and the "remind me before it closes" on a bookmark (migration 356).

  Both were the phone's alone, so the website never showed the note, a new
  phone started without either, and a bookmark taken off on the website left
  the phone's reminder to go off. They are columns of the bookmark now, written
  only here — the website's saved page and the app (through
  /api/mobile/v1/actions) both call these — and taking the bookmark off
  (toggleSavedJob) deletes them with the row.

  Each changes the caller's own row and nothing else; RLS
  (saved_jobs_owner_update) and the guard trigger say so again underneath. A
  listing that is not saved is `not_saved`: the note belongs to a bookmark,
  and there is none to put it on.
*/

const noteSchema = z.object({
  jobId: z.string().uuid(),
  /** Empty, or only blanks, takes the note away. */
  note: z.string().max(SAVED_NOTE_MAX * 4),
});

/** Keeps the note on a saved listing, or — given empty — takes it away. */
export async function setSavedJobNote(input: unknown): Promise<ActionResult<{ note: string | null }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const note = parsed.data.note.trim() || null;
  // Refused rather than cut: the form counts to the limit, so a longer note is
  // not one somebody typed, and cutting it would keep words they never saw kept.
  if (note && note.length > SAVED_NOTE_MAX) return { ok: false, error: 'too_long' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: changed, error } = await supabase
    .from('saved_jobs')
    .update({ note })
    .eq('candidate_id', user.id)
    .eq('job_id', parsed.data.jobId)
    .select('job_id');

  if (error) return failed('note not kept', error, parsed.data.jobId);
  if (!changed?.length) return { ok: false, error: 'not_saved' };

  revalidatePath('/dashboard/saved');
  return { ok: true, data: { note } };
}

const reminderSchema = z.object({
  jobId: z.string().uuid(),
  /** When to remind, as an ISO timestamp; null takes the reminder away. */
  remindAt: z.string().datetime({ offset: true }).nullable(),
});

/**
 * Sets when the app reminds the candidate before a saved listing closes, or —
 * given null — takes the reminder away. The phone works out the moment (the
 * day before the closing, ten in the morning in Cairo) and schedules its own
 * notification from what this keeps; here it is only held to be still to
 * come, and before a listing that is still open closes (`closing` otherwise).
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
    if (at.getTime() <= Date.now() || !jobIsLive(job) || (closes !== null && at.getTime() >= closes)) {
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
