'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { refused } from '@/lib/observe';
import { unknownReplyVariables } from '@/lib/replies';
import { clean } from '@/lib/security/sanitize';
import type { SavedReplyRow } from '@/lib/supabase/database.types';

/**
 * Saved replies (migration 374): a person's own, or — written by an admin —
 * the whole team's; sent on WhatsApp or by email (decided). Who may write
 * which is the database's (saved_replies_own, saved_replies_team); this
 * checks the words: the length, and that every {…} is one of the variables
 * a reply may stand in for.
 */

/** As many as a team keeps to hand: the team's, and each person's own. */
const TEAM_KEPT = 50;
const OWN_KEPT = 30;

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  version: z.number().int().positive().optional(),
  title: z.string().trim().max(80).optional().nullable(),
  body: z.string().trim().min(1).max(1000),
  channel: z.enum(['whatsapp', 'email']),
  teamWide: z.boolean(),
});

export async function saveReply(input: unknown): Promise<ActionResult<{ reply: SavedReplyRow }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const unknown = unknownReplyVariables(parsed.data.body);
  if (unknown.length) return { ok: false, error: 'unknown_variable', fieldErrors: { body: unknown.join(' ') } };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  const { data: companyId } = await supabase.rpc('my_company_id');
  if (!companyId) return { ok: false, error: 'no_company' };

  const row = {
    title: clean(parsed.data.title ?? '', true) || null,
    body: clean(parsed.data.body, true),
    channel: parsed.data.channel,
  };
  if (!row.body) return { ok: false, error: 'invalid' };

  if (parsed.data.id) {
    // Matched on the version read, so two people editing one team reply do not overwrite each other.
    const { data, error } = await supabase
      .from('saved_replies')
      .update({ ...row, version: (parsed.data.version ?? 1) + 1, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.id)
      .eq('version', parsed.data.version ?? 1)
      .select('*');
    if (error) return refused('replies', error, { reply: parsed.data.id });
    if (!data?.length) return { ok: false, error: 'stale' };
    return { ok: true, data: { reply: data[0] as SavedReplyRow } };
  }

  const owner = parsed.data.teamWide ? null : user.id;
  const counted = supabase.from('saved_replies').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const { count } = await (owner ? counted.eq('person_id', owner) : counted.is('person_id', null));
  if ((count ?? 0) >= (owner ? OWN_KEPT : TEAM_KEPT)) return { ok: false, error: 'limit' };

  const { data, error } = await supabase
    .from('saved_replies')
    .insert({ ...row, company_id: companyId, person_id: owner, created_by: user.id })
    .select('*')
    .single();
  // Refused by the policy: a team reply written by somebody who is not an admin.
  if (error?.code === '42501') return { ok: false, error: 'forbidden' };
  if (error || !data) return refused('replies', error ?? {}, { team: parsed.data.teamWide });
  return { ok: true, data: { reply: data as SavedReplyRow } };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function deleteReply(input: unknown): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('saved_replies').delete().eq('id', parsed.data.id).select('id');
  if (error) return refused('replies', error, { reply: parsed.data.id });
  if (!data?.length) return { ok: false, error: 'forbidden' };
  return { ok: true };
}
