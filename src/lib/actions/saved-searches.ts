'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { parseJobFilters } from '@/lib/queries/jobs';
import { toCanonicalQuery } from '@/lib/saved-search';
import type { ActionResult } from '@/lib/actions/jobs';

const saveSchema = z.object({
  label: z.string().trim().min(1).max(80),
  /** The raw query string off the jobs page, re-parsed and re-canonicalised here. */
  query: z.string().max(2000),
});

/**
 * Save the search the candidate is looking at.
 *
 * The query string arrives from the client and is never trusted as-is: it goes
 * through the same parser the jobs page uses and comes back out canonical, so
 * an unknown parameter cannot be smuggled into a row that the weekly digest
 * will later feed back into a query.
 */
export async function saveSearch(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const filters = parseJobFilters(Object.fromEntries(new URLSearchParams(parsed.data.query)));
  const query = toCanonicalQuery(filters);
  if (!query) return { ok: false, error: 'no_filters' };

  const { data, error } = await supabase
    .from('saved_searches')
    .insert({ candidate_id: user.id, label: parsed.data.label, query })
    .select('id')
    .single();

  if (error) {
    // Saving the same filters twice is not a failure worth showing as one.
    if (error.code === '23505') return { ok: false, error: 'already_saved' };
    if (error.message.includes('saved_search_cap')) return { ok: false, error: 'cap' };
    return { ok: false, error: error.message };
  }

  revalidatePath('/dashboard/saved');
  return { ok: true, data: { id: data.id } };
}

export async function deleteSavedSearch(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('saved_searches').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/saved');
  return { ok: true };
}

const alertsSchema = z.object({ id: z.string().uuid(), alerts: z.boolean() });

export async function setSearchAlerts(input: unknown): Promise<ActionResult> {
  const parsed = alertsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('saved_searches')
    .update({ alerts: parsed.data.alerts })
    .eq('id', parsed.data.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/saved');
  return { ok: true };
}
