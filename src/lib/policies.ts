import 'server-only';
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { currentPolicyVersions } from '@/lib/legal';

/**
 * Whether the signed-in person has agreed to the Terms of use and the Privacy
 * policy as they are published now.
 *
 *   current   their latest acceptance names both current versions
 *   outdated  it does not, or there is none — onboarded before acceptances
 *             were recorded, or a document changed since
 *   unknown   the record could not be read (the table not there yet, the
 *             database unreachable): nothing is asked, because nothing asked
 *             could be recorded
 *
 * Cached per request, like getViewer, so the layout and a page both asking
 * cost one read.
 */
export type PolicyStatus = 'current' | 'outdated' | 'unknown';

export const getPolicyStatus = cache(async (userId: string): Promise<PolicyStatus> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('policy_acceptances')
      .select('terms_version, privacy_version')
      .eq('user_id', userId)
      .order('accepted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return 'unknown';
    const now = currentPolicyVersions();
    return data && data.terms_version === now.terms && data.privacy_version === now.privacy
      ? 'current'
      : 'outdated';
  } catch (error) {
    // Next's own control flow (a dynamic read during prerendering) is not a
    // failure to read the record.
    unstable_rethrow(error);
    return 'unknown';
  }
});
