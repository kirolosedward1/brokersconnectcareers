'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { currentPolicyVersions } from '@/lib/legal';
import type { ActionResult } from '@/lib/action-result';

/**
 * The signed-in person agrees to the Terms of use and the Privacy policy as
 * published now — and, by the same words, confirms they are 18 or older.
 *
 * The versions are the server's, never the request's: what somebody agreed to
 * is what this deployment publishes. Recorded by record_policy_acceptance()
 * (migration 336) as the caller, on the database's clock.
 */
export async function acceptPolicies(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { terms, privacy } = currentPolicyVersions();
  const { error } = await supabase.rpc('record_policy_acceptance', {
    p_terms_version: terms,
    p_privacy_version: privacy,
  });
  if (error) return { ok: false, error: 'failed' };

  // The notice asking for this sits in both layouts.
  revalidatePath('/', 'layout');
  return { ok: true };
}
