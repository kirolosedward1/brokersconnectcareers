'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';

/**
 * Mark everything in the reader's feed as read.
 *
 * One statement in the database rather than a round trip per row, and it
 * scopes itself to auth.uid() inside the function — there is no id to pass, so
 * there is no id to get wrong.
 */
export async function markNotificationsRead(): Promise<ActionResult<{ marked: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('mark_notifications_read');
  if (error) return { ok: false, error: error.message };

  // The badge lives in the console's shell, so every page under it is stale.
  revalidatePath('/', 'layout');
  return { ok: true, data: { marked: data ?? 0 } };
}
