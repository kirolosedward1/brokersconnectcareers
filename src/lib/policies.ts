import 'server-only';
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { currentPolicyVersions } from '@/lib/legal';
import type { Viewer } from '@/lib/auth';

/**
 * Whether the signed-in person has agreed to the Terms of use and the Privacy
 * policy as they are published now.
 *
 *   current   they have agreed to both current versions, at some point
 *   outdated  they never have — onboarded before acceptances were recorded,
 *             or a document changed since
 *   unknown   the record could not be read (the table not there yet, the
 *             database unreachable): nothing is asked, because nothing asked
 *             could be recorded
 *
 * Any acceptance of the current pair, not the latest one: after a release
 * that changed a document is rolled back, the documents are an earlier pair
 * again, and somebody who agreed to that pair before was asked again with no
 * way to answer — record_policy_acceptance keeps a pair once, so "I agree"
 * wrote nothing and the notice stayed. (The app reads it the same way,
 * mobile/src/features/policies.ts.)
 *
 * Cached per request, like getViewer, so the layout and a page both asking
 * cost one read.
 */
export type PolicyStatus = 'current' | 'outdated' | 'unknown';

export const getPolicyStatus = cache(async (userId: string): Promise<PolicyStatus> => {
  try {
    const supabase = await createClient();
    const now = currentPolicyVersions();
    const { data, error } = await supabase
      .from('policy_acceptances')
      .select('id')
      .eq('user_id', userId)
      .eq('terms_version', now.terms)
      .eq('privacy_version', now.privacy)
      .limit(1)
      .maybeSingle();
    if (error) return 'unknown';
    return data ? 'current' : 'outdated';
  } catch (error) {
    // Next's own control flow (a dynamic read during prerendering) is not a
    // failure to read the record.
    unstable_rethrow(error);
    return 'unknown';
  }
});

/**
 * Whether the band asking somebody to agree again is drawn (PolicyNotice):
 * signed in, with a profile, and not agreed to the documents as they are now.
 * The site header asks too — over a landing page's film it floats, fixed at
 * the top, and would sit on top of the band.
 */
export async function asksToAgree(viewer: Viewer | null): Promise<boolean> {
  if (!viewer?.profile) return false;
  return (await getPolicyStatus(viewer.userId)) === 'outdated';
}
