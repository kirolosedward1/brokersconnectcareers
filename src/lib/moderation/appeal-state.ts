import type { createClient } from '@/lib/supabase/server';
import type { AppealState, AppealSubjectType } from '@/lib/supabase/database.types';

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Whether the signed-in account can appeal one decision, and what it has
 * already asked. Null when the answer cannot be had — the database predates
 * migration 210, or the read failed — and the page then simply offers nothing,
 * which is the honest thing to show when appealing is not possible.
 */
export async function getAppealState(
  supabase: Client,
  subjectType: AppealSubjectType,
  subjectId: string,
): Promise<AppealState | null> {
  const { data, error } = await supabase.rpc('my_appeal_state', {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
  });
  if (error || !data) return null;
  return data as AppealState;
}
