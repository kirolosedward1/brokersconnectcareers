'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { adminErrorCode } from '@/lib/admin/errors';
import { publish } from '@/lib/notifications/events';
import { notifyJobChanged } from '@/lib/seo/indexing-api';
import { jobIsLive } from '@/lib/job-state';

/**
 * The moderation levers that act on reports by id, on a person's ability to
 * report, and on appeals (migrations 326 and 328).
 *
 * Same contract as the console's other levers (lib/actions/admin.ts): one call
 * to a database function through the admin's own session, which refuses
 * anybody but an admin, locks what it changes, refuses a transition that makes
 * no sense, requires a reason where somebody is owed one, and writes the audit
 * record in the same transaction. A success here means both committed.
 */
async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return profile?.role === 'admin' ? supabase : null;
}

function refreshConsole() {
  revalidatePath('/admin', 'layout');
}

const closeSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(['investigating', 'resolved', 'dismissed']),
  note: z.string().trim().max(500).optional(),
  abusive: z.boolean().default(false),
});

/**
 * Move reports by id: the ones about a deleted listing or profile (which the
 * per-target lever can no longer find), or one report dismissed as filed in
 * bad faith — which the reporter's record then shows the next moderator, and
 * which restricts nobody by itself.
 */
export async function closeReports(input: unknown): Promise<ActionResult<{ moved: number }>> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data, error } = await supabase.rpc('admin_close_reports', {
    p_reports: parsed.data.ids,
    p_status: parsed.data.status,
    p_note: parsed.data.note || null,
    p_abusive: parsed.data.abusive,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  refreshConsole();
  return { ok: true, data: { moved: Number(data ?? 0) } };
}

const reportingSchema = z.object({
  userId: z.string().uuid(),
  restrict: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

/** Stop, or allow again, one account's reports. A reason is always required. */
export async function setReportingRestriction(input: unknown): Promise<ActionResult> {
  const parsed = reportingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'reason_required' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { error } = await supabase.rpc('admin_set_reporting_restriction', {
    p_user: parsed.data.userId,
    p_restrict: parsed.data.restrict,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  refreshConsole();
  return { ok: true };
}

const appealSchema = z.object({
  appealId: z.string().uuid(),
  overturn: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Answer an appeal. Overturning reverses the decision through the lever a
 * moderator would use by hand, in the same transaction as the answer; the
 * appellant is told either way, in the bell (by the database). A listing
 * brought back is also published as approved — the company's email — and
 * announced to Google, as any restoration is.
 */
export async function decideAppeal(input: unknown): Promise<ActionResult> {
  const parsed = appealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data: appeal } = await supabase
    .from('moderation_appeals')
    .select('subject_type, subject_id')
    .eq('id', parsed.data.appealId)
    .maybeSingle();

  const { error } = await supabase.rpc('admin_decide_appeal', {
    p_appeal: parsed.data.appealId,
    p_overturn: parsed.data.overturn,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  if (parsed.data.overturn && appeal?.subject_type === 'job') {
    const jobId = appeal.subject_id;
    const { data: job } = await supabase.from('jobs').select('slug, status, expires_at').eq('id', jobId).maybeSingle();
    // Announced only if the restored listing is live by the date too: one whose
    // window ran out while it was down comes back as expired, with nothing new
    // for Google to read.
    if (job && jobIsLive(job)) {
      const slug = job.slug;
      after(() => publish({ type: 'JOB_APPROVED', jobId }));
      after(() => notifyJobChanged(slug, 'URL_UPDATED'));
    }
  }

  refreshConsole();
  if (parsed.data.overturn) {
    revalidatePath('/jobs');
    revalidatePath('/companies');
    revalidatePath('/agents');
  }
  return { ok: true };
}
