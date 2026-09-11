'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';

/**
 * The company's shortlist, which is not the same thing as a listing's.
 *
 * `applications.status = 'shortlisted'` says "for this role". A brokerage
 * hiring continuously wants the other list: the consultant who was strong but
 * second last month, and the one they met in the directory before a role for
 * them existed. That list belongs to the company rather than to whoever
 * pressed the button, for the same reason the applicant inbox does.
 *
 * Every rule that matters here lives in the database — migration 60's insert
 * policy decides whether this viewer may keep this card at all, and
 * `saved_agent_cards()` decides on every read what of the person may still be
 * shown. This is the button; it is deliberately not a second copy of either.
 */

const agentId = z.string().uuid();

export async function toggleSavedAgent(
  input: unknown,
): Promise<ActionResult<{ saved: boolean }>> {
  const parsed = agentId.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Through membership, not ownership: a recruiter invited to the team keeps
  // the same list their colleagues do.
  const { data: companyId } = await supabase.rpc('my_company_id');
  if (!companyId) return { ok: false, error: 'no_company' };

  const { data: existing } = await supabase
    .from('saved_agents')
    .select('agent_id')
    .eq('company_id', companyId)
    .eq('agent_id', parsed.data)
    .maybeSingle();

  if (existing) {
    /*
      `.select()` after the delete, because a row-level-security refusal is not
      an error.

      A delete that matches nothing comes back clean, so without reading what
      it removed this would report success for a row it never touched — and
      the button would show the consultant dropped from a list they are still
      on, until the next reload put them back.
    */
    const { data: removed, error } = await supabase
      .from('saved_agents')
      .delete()
      .eq('company_id', companyId)
      .eq('agent_id', parsed.data)
      .select('agent_id');

    if (error) return { ok: false, error: error.message };
    if (!removed?.length) return { ok: false, error: 'forbidden' };

    revalidatePath('/employer/talent');
    return { ok: true, data: { saved: false } };
  }

  const { error } = await supabase
    .from('saved_agents')
    .insert({ company_id: companyId, agent_id: parsed.data, saved_by: user.id });

  if (error) {
    // A card this company may not keep. The policy is the authority on that,
    // and it answers by refusing the row rather than by explaining — which is
    // right: the explanation would be a fact about the consultant's settings.
    if (error.code === '42501') return { ok: false, error: 'not_allowed' };
    if (error.message.includes('saved_agent_cap')) return { ok: false, error: 'cap' };
    // Two colleagues pressing at once. The list is the outcome either way.
    if (error.code === '23505') return { ok: true, data: { saved: true } };
    return { ok: false, error: error.message };
  }

  revalidatePath('/employer/talent');
  return { ok: true, data: { saved: true } };
}
