'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { AGENT_REPORT_REASONS, COMPANY_REPORT_REASONS, REPORT_REASONS } from '@/lib/taxonomy';
import { clean } from '@/lib/security/sanitize';
import { logFailure } from '@/lib/observe';

export type ReportTarget = 'job' | 'company' | 'agent';

/**
 * Each target accepts its own reasons, so a listing cannot be reported for
 * "impersonation" through a hand-built request any more than through the
 * form. The database's check admits the union; this is the finer rule.
 */
const reportSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('job'), targetId: z.string().uuid(), reason: z.enum(REPORT_REASONS) }),
  z.object({ target: z.literal('company'), targetId: z.string().uuid(), reason: z.enum(COMPANY_REPORT_REASONS) }),
  z.object({ target: z.literal('agent'), targetId: z.string().uuid(), reason: z.enum(AGENT_REPORT_REASONS) }),
]);

const detailSchema = z.string().trim().max(1000).optional();

/**
 * Reporting is something an account does.
 *
 * It used to accept `reporter_id: null`, which read as friendlier and was
 * unworkable: nobody to rate-limit, nobody to ask a follow-up question, and
 * nobody who can be wrong twice. The queue those rows land in is read by a
 * person, which is exactly what makes it worth flooding.
 *
 * The same door now serves companies and consultant profiles. The rules are
 * the database's (migration 315): one report per person per target, ten a day,
 * none from a suspended account, none about your own company or profile.
 *
 * The distinct outcomes are named rather than collapsed into one failure,
 * because "you already reported this" and "something went wrong" ask the
 * reader for completely different next steps.
 */
export async function reportTarget(input: unknown): Promise<ActionResult> {
  const parsed = reportSchema.safeParse(input);
  const detail = detailSchema.safeParse((input as { detail?: unknown } | null)?.detail);
  if (!parsed.success || !detail.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'unauthenticated' };

  const { target, targetId } = parsed.data;
  const { error } = await supabase.from('reports').insert({
    job_id: target === 'job' ? targetId : null,
    company_id: target === 'company' ? targetId : null,
    agent_id: target === 'agent' ? targetId : null,
    reporter_id: user.id,
    reason: parsed.data.reason,
    detail: clean(detail.data, true) || null,
  });

  if (error) {
    if (error.message.includes('report_rate_limit')) return { ok: false, error: 'rate_limit' };
    // The unique indexes on (target, reporter_id).
    if (error.code === '23505') return { ok: false, error: 'already_reported' };
    // The database's own words name constraints and triggers; they go to the
    // log with the row's identifiers, and the caller gets a code.
    logFailure('report', 'report refused', { [target]: targetId, code: error.code ?? undefined });
    return { ok: false, error: 'failed' };
  }

  return { ok: true };
}
