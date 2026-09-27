'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { allow } from '@/lib/rate-limit';
import { AVATAR_BUCKET, CV_BUCKET } from '@/lib/buckets';
import { isOwnStoragePath } from '@/lib/storage-path';
import type { ActionResult } from '@/lib/actions/jobs';
import { after } from 'next/server';
import { notifyPasswordChanged } from '@/lib/email/notify';
import { logFailure } from '@/lib/observe';

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

  // Uploaded files first. Storage objects are not reached by the database
  // cascade, and a CV outliving the account it belonged to is the exact
  // failure this feature exists to prevent.
  for (const bucket of [CV_BUCKET, AVATAR_BUCKET] as const) {
    try {
      await removeFolder(admin, bucket, user.id);
    } catch (error) {
      // A missing bucket must not block the deletion. Losing the account is
      // the part the person asked for; an orphaned file is a smaller wrong
      // than an account that would not die.
      logFailure('account', `could not clear ${bucket}`, {
        user: user.id,
        detail: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  await supabase.auth.signOut();
  return { ok: true };
}

/**
 * Every file in one account's folder, however many there are.
 *
 * `list()` answers a hundred at a time by default. An account that replaced
 * its photo a hundred times would have kept the hundred-and-first, so this
 * pages until the folder is empty.
 */
async function removeFolder(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  folder: string,
): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    const { data: files } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    const paths = (files ?? []).map((file) => `${folder}/${file.name}`);
    if (!paths.length) return;
    await admin.storage.from(bucket).remove(paths);
  }
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
 * storage policy checks that the folder is the uploader's own. This turns the
 * path into a URL and writes it down through the caller's own session, so the
 * row it updates is theirs by the same rule; the `profiles_10_guard_avatar`
 * trigger refuses any URL that is not a file in that folder.
 *
 * The photo it replaces is deleted afterwards, and so is the one a "remove"
 * clears. The old rule was to keep them — "a page still holding the old URL
 * would break" — and what it produced was a public bucket that kept every
 * photo anybody had ever uploaded, including the ones they had asked to have
 * taken down. A stale page shows a monogram for a second; a photo somebody
 * removed staying on a public URL forever is the wrong trade.
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

  // The path is not taken on trust: exactly the account's own folder and one
  // file in it, whatever the caller sent.
  if (parsed.data.storagePath && !isOwnStoragePath(user.id, parsed.data.storagePath)) {
    return { ok: false, error: 'forbidden' };
  }

  const { data: before } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle();

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

  /*
    The previous file, gone. Only a file in this account's own folder of the
    avatars bucket — a Google picture is not ours to delete, and nothing else
    can be in the column. Through the caller's own session, which the storage
    policy confines to their folder; a failure is logged and the save stands,
    because a photo that saved is what they asked for.
  */
  const previous = ownAvatarPath(user.id, before?.avatar_url);
  if (previous && previous !== parsed.data.storagePath) {
    const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([previous]);
    if (removeError) {
      logFailure('account', 'could not remove the replaced photo', { user: user.id });
    }
  }

  revalidatePath('/dashboard/account');
  revalidatePath('/dashboard/profile');
  revalidatePath('/agents');
  return { ok: true };
}

/** The storage path inside a public avatar URL, when it is one of ours and in this folder. */
function ownAvatarPath(userId: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
  return isOwnStoragePath(userId, path) ? path : null;
}

/**
 * Take a file back out of storage after a save that did not happen.
 *
 * The browser uploads before the action runs, so a refused save leaves a
 * file with nothing pointing at it. The browser can remove its own upload —
 * the storage policy allows it — but it cannot when the reason the save
 * failed was that the session had ended. This is the same removal with the
 * same rule, through the account's own session, for the paths that are
 * demonstrably theirs.
 */
export async function discardUpload(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ bucket: z.enum([AVATAR_BUCKET, CV_BUCKET]), storagePath: z.string().trim().max(300) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  if (!isOwnStoragePath(user.id, parsed.data.storagePath)) return { ok: false, error: 'forbidden' };

  const { error } = await supabase.storage.from(parsed.data.bucket).remove([parsed.data.storagePath]);
  if (error) return { ok: false, error: 'unavailable' };
  return { ok: true };
}
