import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { refused } from '@/lib/observe';

/**
 * A decline or a live listing's pay change the company has an admin approve
 * (migration 380): one waiting request per thing, which a second ask joins.
 * The move itself waits, and the caller is told so (pendingApproval).
 */
export async function askForApproval(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: 'decline' | 'pay_change',
  subjectId: string,
  payload: Record<string, unknown>,
): Promise<ActionResult<{ reasonKept: boolean; pendingApproval: boolean }>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  const { data: companyId } = await supabase.rpc('my_company_id');
  if (!companyId) return { ok: false, error: 'no_company' };
  const { error } = await supabase
    .from('company_approval_requests')
    .insert({ company_id: companyId, kind, subject_id: subjectId, payload, requested_by: user.id });
  // Already waiting: the same request.
  if (error && error.code !== '23505') return refused('approval', error, { kind, subject: subjectId });
  return { ok: true, data: { reasonKept: true, pendingApproval: true } };
}
