'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { setApplicationStatus } from '@/lib/actions/applications';
import { refused } from '@/lib/observe';
import { PIPELINE_STAGES } from '@/lib/application-stages';

const rulesSchema = z.object({
  approveDecline: z.boolean(),
  approvePayChange: z.boolean(),
  spendCeilingMonthEgp: z.number().int().min(0).max(10_000_000).nullable(),
  requireMfa: z.boolean(),
  cvAdminsOnly: z.boolean(),
});

/**
 * The rules a company sets for its own team (migration 380, Phase B 05). A
 * company admin's, under the policies' admin check. Requiring a second factor
 * is refused from a session that has not used one ('mfa_required').
 */
export async function saveCompanyRules(input: unknown): Promise<ActionResult> {
  const parsed = rulesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const { data: companyId } = await supabase.rpc('my_company_id');
  if (!companyId) return { ok: false, error: 'no_company' };

  const { data, error } = await supabase
    .from('company_policies')
    .upsert(
      {
        company_id: companyId,
        approve_decline: parsed.data.approveDecline,
        approve_pay_change: parsed.data.approvePayChange,
        spend_ceiling_month_egp: parsed.data.spendCeilingMonthEgp,
        require_mfa: parsed.data.requireMfa,
        cv_admins_only: parsed.data.cvAdminsOnly,
      },
      { onConflict: 'company_id' },
    )
    .select('company_id');
  if (error?.message.includes('mfa_required_to_require')) return { ok: false, error: 'mfa_required' };
  if (error) return refused('company', error, { company: companyId });
  if (!data?.length) return { ok: false, error: 'forbidden' };
  revalidatePath('/employer/company');
  return { ok: true };
}

const decisionSchema = z.object({
  id: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional().nullable(),
});

const declinePayload = z.object({
  from: z.enum(PIPELINE_STAGES).nullable().optional(),
  decisionNote: z.string().max(500).nullable().optional(),
  shareReason: z.boolean().optional(),
});

const payPayload = z.object({
  basic_salary_min: z.number().int().nullable(),
  basic_salary_max: z.number().int().nullable(),
  commission_type: z.string(),
  commission_value: z.number().nullable(),
  commission_note_ar: z.string().nullable(),
});

/**
 * An admin approves or refuses what a colleague asked for. Approved, the
 * thing is done now, as the admin: the decline through the ordinary move
 * (the candidate told as any decline tells them; a colleague who moved the
 * applicant since makes it 'expired'), the pay written to the listing.
 */
export async function decideApprovalRequest(input: unknown): Promise<ActionResult<{ outcome: 'approved' | 'refused' | 'expired' }>> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: request, error: readError } = await supabase
    .from('company_approval_requests')
    .select('*')
    .eq('id', parsed.data.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (readError) return refused('approval', readError, { request: parsed.data.id });
  if (!request) return { ok: false, error: 'not_found' };

  let outcome: 'approved' | 'refused' | 'expired' = parsed.data.approve ? 'approved' : 'refused';
  if (parsed.data.approve && request.kind === 'decline') {
    const payload = declinePayload.safeParse(request.payload);
    const moved = await setApplicationStatus({
      applicationId: request.subject_id,
      status: 'rejected',
      decisionNote: payload.success ? (payload.data.decisionNote ?? null) : null,
      ...(payload.success && payload.data.from ? { from: payload.data.from } : {}),
      ...(payload.success && payload.data.shareReason === false ? { shareReason: false } : {}),
    });
    if (!moved.ok && moved.error === 'moved_already') outcome = 'expired';
    else if (!moved.ok) return moved;
  }
  if (parsed.data.approve && request.kind === 'pay_change') {
    const payload = payPayload.safeParse(request.payload);
    if (!payload.success) return { ok: false, error: 'invalid' };
    const { data: job, error } = await supabase
      .from('jobs')
      .update(payload.data as never)
      .eq('id', request.subject_id)
      .eq('company_id', request.company_id)
      .select('id');
    if (error) return refused('approval', error, { request: request.id });
    if (!job?.length) outcome = 'expired';
  }

  const { data: decided, error } = await supabase
    .from('company_approval_requests')
    .update({ status: outcome, decided_by: user.id, decided_at: new Date().toISOString(), note: parsed.data.note || null })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select('id');
  if (error) return refused('approval', error, { request: request.id });
  if (!decided?.length) return { ok: false, error: 'not_found' };
  revalidatePath('/employer/jobs');
  return { ok: true, data: { outcome } };
}
