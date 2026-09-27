'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { allow } from '@/lib/rate-limit';
import { AVATAR_BUCKET } from '@/lib/buckets';
import type { ActionResult } from '@/lib/actions/jobs';
import { after } from 'next/server';
import { notifyPasswordChanged } from '@/lib/email/notify';

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

  /*
    owner_id, deliberately, and not membership like everywhere else: the
    question here is "does deleting this account orphan a company", which only
    the owner can. A colleague leaving is just a membership row cascading away,
    and they may close their account freely.
  */
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

  /*
    The account first, the files second.

    This used to run the other way round, and a failure in between left the
    worse of the two half-states: files gone, account still alive, with a
    profile and applications pointing at CVs that no longer existed. In this
    order a failure leaves the opposite — no account, a file behind it — and
    that is the state the storage sweep exists to finish (migration 204): the
    cascade has already queued every CV and photo this account referenced.

    Removed here as well, immediately, rather than left to the sweep's grace
    period. The grace period protects a public URL somebody may still be
    looking at; a person asking to be deleted is owed the prompt removal of
    their CV, which nobody else is looking at.
  */
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  for (const bucket of ['cvs', 'avatars'] as const) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(user.id);
      const paths = (files ?? []).map((file) => `${user.id}/${file.name}`);
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    } catch (error) {
      // The account is already gone; a file left behind is queued for the
      // sweep and will not outlive its grace period.
      console.warn(
        `[account] could not clear ${bucket} for ${user.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  await supabase.auth.signOut();
  return { ok: true };
}


/**
 * Tell the account holder their password changed.
 *
 * Supabase's updateUser runs in the browser, so nothing on the server sees the
 * change happen — this is how the server hears about it. That makes it the one
 * email trigger reachable by a caller who is merely signed in, so it takes no
 * arguments at all: there is no user id to pass, no address to specify, and
 * nothing to point somewhere else. It mails the session's own account or it
 * does nothing.
 *
 * The claim is checked rather than believed. notifyPasswordChanged requires
 * auth.users.updated_at to have moved in the last few minutes, so calling this
 * without changing anything sends nothing.
 */
export async function announcePasswordChange(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // The evidence check already stops a call that changed nothing; this stops a
  // loop of real changes from becoming a loop of mail. Answered ok either way —
  // the password change itself succeeded, which is what the caller cares about.
  if (!(await allow(`password_notice:${user.id}`, 5, 3600))) return { ok: true };

  after(() => notifyPasswordChanged(user.id));
  return { ok: true };
}

const preferencesSchema = z.object({
  notify_applications: z.boolean(),
  notify_status: z.boolean(),
  notify_digest: z.boolean(),
  notify_applicant_digest: z.boolean(),
});

/**
 * The email switches.
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

  const { data: saved, error } = await supabase
    .from('profiles')
    .update(parsed.data)
    .eq('id', user.id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // The switch flips optimistically and puts itself back when this says no, so
  // a write RLS filtered to nothing has to say no rather than nothing at all.
  if (!saved?.length) return { ok: false, error: 'not_found' };

  revalidatePath('/dashboard/account');
  return { ok: true };
}

const avatarSchema = z.object({
  /** Null clears the photo and goes back to the monogram. */
  storagePath: z.string().trim().max(300).nullable(),
});

/**
 * Record a profile photo, or clear it.
 *
 * The file is already in the public `avatars` bucket by the time this runs —
 * the browser puts it there, into a folder named for the account, where a
 * storage policy checks that the folder is the uploader's own. This only turns
 * the path into a URL and writes it down, and it writes it through the
 * caller's own session so the row it updates is theirs by the same rule.
 *
 * `.select()` because an update that RLS filters to zero rows comes back with
 * no error at all, and reporting success for a save that saved nothing is the
 * failure this codebase keeps meeting.
 */
export async function saveAvatar(input: unknown): Promise<ActionResult> {
  const parsed = avatarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // The path is not taken on trust: it must be inside this account's own
  // folder, whatever the caller sent.
  if (parsed.data.storagePath && !parsed.data.storagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: 'forbidden' };
  }

  const url = parsed.data.storagePath
    ? supabase.storage.from(AVATAR_BUCKET).getPublicUrl(parsed.data.storagePath).data.publicUrl
    : null;

  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', user.id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!updated?.length) return { ok: false, error: 'not_found' };

  revalidatePath('/dashboard/account');
  revalidatePath('/dashboard/profile');
  revalidatePath('/agents');
  return { ok: true };
}
