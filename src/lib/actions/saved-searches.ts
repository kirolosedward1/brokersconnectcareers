'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { parseJobFilters } from '@/lib/queries/jobs';
import { followQuery, toCanonicalQuery } from '@/lib/saved-search';
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
  // RLS scopes this to the caller's own searches, and filtering to zero rows is
  // not an error — so deleting somebody else's reported success.
  const { data: removed, error } = await supabase
    .from('saved_searches')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!removed?.length) return { ok: false, error: 'forbidden' };

  revalidatePath('/dashboard/saved');
  return { ok: true };
}

const alertsSchema = z.object({ id: z.string().uuid(), alerts: z.boolean() });

export async function setSearchAlerts(input: unknown): Promise<ActionResult> {
  const parsed = alertsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from('saved_searches')
    .update({ alerts: parsed.data.alerts })
    .eq('id', parsed.data.id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!changed?.length) return { ok: false, error: 'forbidden' };

  revalidatePath('/dashboard/saved');
  return { ok: true };
}


/* ---------------------------------------------------------------------------
   Following a company.

   A consultant who wants to work for one specific developer's brokerage had no
   way to hear when they post — they had to remember to come back and look.

   Deliberately not a table. A follow is a saved search whose only filter is
   the company, which means the weekly alert job already delivers it, the
   unsubscribe link already covers it, the ten-row cap already bounds it, and
   there is no second notion of "what this person wants to hear about" to keep
   in step with the first. The one cost is that follows and searches share that
   cap, which the copy on both surfaces says out loud rather than leaving to be
   discovered at the moment of failure.
   --------------------------------------------------------------------------- */

const followSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,80}$/),
  /** The company's name in the reader's language — what the digest will call it. */
  label: z.string().trim().min(1).max(80),
});

export async function followCompany(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = followSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const query = followQuery(parsed.data.slug);

  const { data, error } = await supabase
    .from('saved_searches')
    .insert({ candidate_id: user.id, label: parsed.data.label, query, alerts: true })
    .select('id')
    .single();

  if (error) {
    /*
      Already following is not a failure.

      The button is a toggle, and a toggle that reports an error when the world
      already matches what it was asked for is a toggle that will get pressed
      twice. The row is the follow; finding one is the outcome. Its alerts flag
      is left exactly as the owner set it — re-pressing Follow must not quietly
      switch weekly mail back on for somebody who turned it off.
    */
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('saved_searches')
        .select('id')
        .eq('query', query)
        .maybeSingle();
      if (existing) return { ok: true, data: { id: existing.id } };
    }
    if (error.message.includes('saved_search_cap')) return { ok: false, error: 'cap' };
    return { ok: false, error: error.message };
  }

  revalidatePath('/dashboard/saved');
  return { ok: true, data: { id: data.id } };
}

export async function unfollowCompany(slug: unknown): Promise<ActionResult> {
  const parsed = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{1,80}$/)
    .safeParse(slug);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  // RLS scopes the delete to the caller's own rows. Removing nothing is
  // reported as success here, unlike deleteSavedSearch by id: the id form can
  // only be aimed at somebody else's row, while this one names a company, and
  // "stop following" has got what it asked for either way.
  const { error } = await supabase
    .from('saved_searches')
    .delete()
    .eq('query', followQuery(parsed.data));

  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/saved');
  return { ok: true };
}
