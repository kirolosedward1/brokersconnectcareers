'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';

const appealSchema = z.object({
  subjectType: z.enum(['job', 'company', 'account', 'agent']),
  subjectId: z.string().uuid(),
  message: z.string().trim().min(10).max(1000),
});

export type AppealRefusal =
  | 'message_required'
  | 'not_appealable'
  | 'appeal_open'
  | 'appeal_limit'
  | 'appeal_too_soon'
  | 'rate_limit'
  | 'company_suspended'
  | 'unavailable';

/** The database's words (migration 328), each with its own sentence in the form. */
const REFUSALS: [needle: string, code: AppealRefusal][] = [
  ['appeal_message_required', 'message_required'],
  ['appeal_message_too_long', 'message_required'],
  ['not_appealable', 'not_appealable'],
  ['appeal_open', 'appeal_open'],
  ['appeal_limit', 'appeal_limit'],
  ['appeal_too_soon', 'appeal_too_soon'],
  ['appeal_rate_limit', 'rate_limit'],
  ['company_suspended', 'company_suspended'],
];

/**
 * Ask for a decision to be looked at again.
 *
 * One message about one decision; the database decides whether this account
 * may appeal it (the company for its listings and its suspension, a person
 * for their own account or consultant profile) and whether it is too soon or
 * too often. A moderator's answer comes back as a notification.
 */
export async function submitAppeal(input: unknown): Promise<ActionResult> {
  const parsed = appealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'message_required' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.rpc('submit_appeal', {
    p_subject_type: parsed.data.subjectType,
    p_subject_id: parsed.data.subjectId,
    p_message: parsed.data.message,
  });

  if (error) {
    // The function the deployed database does not have yet.
    if (error.code === 'PGRST202' || error.code === '42883') return { ok: false, error: 'unavailable' };
    for (const [needle, code] of REFUSALS) {
      if (error.message.includes(needle)) return { ok: false, error: code };
    }
    console.warn('[appeals] could not file an appeal:', error.message);
    return { ok: false, error: 'failed' };
  }

  revalidatePath('/employer', 'layout');
  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}
