'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/actions/jobs';

/**
 * Deleting your own account.
 *
 * The database cascades from auth.users all the way down: profile, consultant
 * profile, saved jobs, applications. For a candidate that is exactly right —
 * every row it reaches is theirs.
 *
 * For a company owner it is not. The chain continues profiles -> companies ->
 * jobs -> applications, so deleting one employer's login would also delete the
 * company record, every listing it ever published, and the applications other
 * people submitted to those listings. Those applications are other candidates'
 * data, and their own copy of their history. A self-service button must not be
 * able to do that by accident, so this refuses and says why.
 *
 * That is not a refusal of the erasure right. It is a refusal to let one
 * person erase several other people at the same time, which the right never
 * covered.
 */
export async function deleteMyAccount(): Promise<ActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Read through the caller's own session: RLS confirms this really is their
  // company rather than trusting an id passed in from anywhere.
  const { data: company } = await supabase
    .from('companies')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (company) return { ok: false, error: 'owns_company' };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // No service-role key configured. Say so rather than reporting a deletion
    // that did not happen.
    return { ok: false, error: 'unavailable' };
  }

  // Uploaded files first. Storage objects are not reached by the database
  // cascade, and a CV outliving the account it belonged to is the exact
  // failure this feature exists to prevent.
  for (const bucket of ['cvs', 'avatars'] as const) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(user.id);
      const paths = (files ?? []).map((file) => `${user.id}/${file.name}`);
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    } catch (error) {
      // A missing bucket must not block the deletion. Losing the account is
      // the part the person asked for; an orphaned file is a smaller wrong
      // than an account that would not die.
      console.warn(
        `[account] could not clear ${bucket} for ${user.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  await supabase.auth.signOut();
  return { ok: true };
}


const preferencesSchema = z.object({
  notify_applications: z.boolean(),
  notify_status: z.boolean(),
  notify_digest: z.boolean(),
});

/**
 * The three email switches.
 *
 * Written through the caller's own session, so RLS decides which row this can
 * touch, and guard_profile_update rejects any attempt to smuggle a role change
 * or a new unsubscribe token in alongside them.
 */
export async function updateNotificationPreferences(input: unknown): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.from('profiles').update(parsed.data).eq('id', user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/account');
  return { ok: true };
}
