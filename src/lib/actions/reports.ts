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
 * "harassment" through a hand-built request any more than through the form.
 * The database's check admits the union; this is the finer rule.
 */
const reportSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('job'), targetId: z.string().uuid(), reason: z.enum(REPORT_REASONS) }),
  z.object({ target: z.literal('company'), targetId: z.string().uuid(), reason: z.enum(COMPANY_REPORT_REASONS) }),
  z.object({ target: z.literal('agent'), targetId: z.string().uuid(), reason: z.enum(AGENT_REPORT_REASONS) }),
]);

const detailSchema = z.string().trim().max(1000).optional();

/**
 * The refusals the database names (migrations 19 and 326), each mapped to a
 * word the dialog turns into its own sentence. "Try tomorrow", "wait a few
 * minutes" and "we already have it" ask the reader for different things.
 */
const REFUSALS: [needle: string, code: ReportRefusal][] = [
  ['report_rate_limit', 'rate_limit'],
  ['report_burst_limit', 'burst_limit'],
  ['report_new_account_limit', 'new_account_limit'],
  ['report_company_limit', 'company_limit'],
  ['reporting_restricted', 'restricted'],
  ['report_own_target', 'own_target'],
];

export type ReportRefusal =
  | 'rate_limit'
  | 'burst_limit'
  | 'new_account_limit'
  | 'company_limit'
  | 'restricted'
  | 'own_target'
  | 'already_reported';

/**
 * Reporting is something an account does.
 *
 * It used to accept `reporter_id: null`, which read as friendlier and was
 * unworkable: nobody to rate-limit, nobody to ask a follow-up question, and
 * nobody who can be wrong twice. The queue those rows land in is read by a
 * person, which is exactly what makes it worth flooding.
 *
 * The same door serves listings, companies and consultant profiles (migration
 * 317). The rules are the database's, so a hand-built request meets the same
 * ones: one report per person per target, ten a day, three in ten minutes,
 * three on an account's first day, three a week about any one company, none
 * about your own company or profile, none while suspended or under a
 * reporting ban. And none of them hides or removes anything: a report asks a
 * person to look.
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
    // The detail is read by a moderator in the console: tags, invisible and
    // control characters and bidi overrides are stripped first (#13).
    detail: clean(detail.data, true) || null,
  });

  if (error) {
    for (const [needle, code] of REFUSALS) {
      if (error.message.includes(needle)) return { ok: false, error: code };
    }
    // The unique indexes on (target, reporter_id).
    if (error.code === '23505') return { ok: false, error: 'already_reported' };
    // Row-level security: a suspended account files no reports.
    if (error.code === '42501') return { ok: false, error: 'restricted' };
    // The database's own words name constraints and triggers; they go to the
    // log with the row's identifiers, and the caller gets a code.
    logFailure('report', 'report refused', { [target]: targetId, code: error.code ?? undefined });
    return { ok: false, error: 'failed' };
  }

  return { ok: true };
}
