'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { buildAgentSlug } from '@/lib/slug';
import { withUniqueSlug } from '@/lib/actions/unique-slug';
import { normalisePhone, isValidPhone } from '@/lib/phone';
import { isOwnStoragePath } from '@/lib/storage-path';
import { CV_BUCKET } from '@/lib/buckets';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';
import { after } from 'next/server';
import { notifyProfileReady, notifyVisibilityChanged } from '@/lib/email/notify';
import { logFailure } from '@/lib/observe';

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(6).max(24),
  headlineAr: z.string().trim().max(160).optional().nullable(),
  headlineEn: z.string().trim().max(160).optional().nullable(),
  yearsExperience: z.coerce.number().int().min(0).max(60),
  tracks: z.array(z.enum(JOB_TRACKS)).max(6),
  districtIds: z.array(z.coerce.number().int().positive()).max(20),
  developerIds: z.array(z.coerce.number().int().positive()).max(30),
  languages: z.array(z.enum(['ar', 'en', 'fr'])).max(3),
  availability: z.enum(AVAILABILITIES),
  visibility: z.enum(['public', 'verified_employers_only', 'hidden']),
  /** A newly uploaded file, or nothing. */
  cvPath: z.string().trim().max(512).optional().nullable(),
  /** Take the current CV down, whether or not a new one is coming. */
  removeCv: z.boolean().optional(),
});

/**
 * Creates or updates the signed-in candidate's agent directory profile.
 *
 * `visibility` is the whole point of this form: an agent who is currently
 * employed can set `hidden` and disappear from the directory entirely, which is
 * what makes it safe for them to have a profile at all.
 *
 * The role is the database's to check. agent_profiles_write_own requires
 * is_candidate() and the trigger from migration 48 refuses any other kind of
 * account whoever is writing, so an employer calling this is refused there.
 */
export async function saveAgentProfile(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // Name the field, the way applyToJob does, so the form can point at it
    // instead of falling back to "something went wrong" under the button.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (!field || fieldErrors[field]) continue;
      fieldErrors[field] = field === 'whatsapp' ? 'invalidPhone' : 'required';
    }
    return { ok: false, error: 'invalid', fieldErrors };
  }

  const phone = normalisePhone(parsed.data.whatsapp);
  if (!isValidPhone(phone)) {
    return { ok: false, error: 'invalid', fieldErrors: { whatsapp: 'invalidPhone' } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Exactly this account's folder and one file in it. The database says the
  // same (agent_profiles_cv_is_the_owners), so this is the earlier, clearer
  // refusal rather than the only one.
  if (parsed.data.cvPath && !isOwnStoragePath(user.id, parsed.data.cvPath)) {
    return { ok: false, error: 'invalid_cv_path' };
  }

  const { data: profileSaved, error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: parsed.data.fullName, whatsapp_phone: phone })
    .eq('id', user.id)
    .select('id');
  if (profileError) return { ok: false, error: profileError.message };
  if (!profileSaved?.length) return { ok: false, error: 'not_found' };

  const { data: existing } = await supabase
    .from('agent_profiles')
    .select('id, slug, cv_path, visibility')
    .eq('user_id', user.id)
    .maybeSingle();

  /*
    Which CV the row ends up pointing at.

    A new upload replaces the current one; "remove" clears it; neither means
    the current one stays. The file that stops being referenced is deleted
    after the row is written, so a save that fails leaves the old file where
    the row still points.
  */
  const nextCv = parsed.data.cvPath || (parsed.data.removeCv ? null : (existing?.cv_path ?? null));
  const orphanedCv = existing?.cv_path && existing.cv_path !== nextCv ? existing.cv_path : null;

  const payload = {
    headline_ar: parsed.data.headlineAr || null,
    headline_en: parsed.data.headlineEn || null,
    years_experience: parsed.data.yearsExperience,
    tracks: parsed.data.tracks,
    district_ids: parsed.data.districtIds,
    languages: parsed.data.languages,
    availability: parsed.data.availability,
    visibility: parsed.data.visibility,
    cv_path: nextCv,
  };

  let agentId = existing?.id;
  let createdSlug: string | null = null;

  if (existing) {
    const { data: updated, error } = await supabase
      .from('agent_profiles')
      .update(payload)
      .eq('id', existing.id)
      .select('id');
    if (error) return { ok: false, error: error.message };
    // An update RLS filters to zero rows carries no error, and this form is
    // the one place a consultant sets their own visibility — reporting a save
    // that did not happen would leave them believing they are hidden.
    if (!updated?.length) return { ok: false, error: 'not_found' };
  } else {
    const { data, error } = await withUniqueSlug<{ id: string }>(
      () => buildAgentSlug(parsed.data.fullName),
      (slug) =>
        supabase.from('agent_profiles').insert({ user_id: user.id, slug, ...payload }).select('id').single(),
    );
    if (error || !data) return { ok: false, error: error?.message ?? 'insert_failed' };
    agentId = data.id;
    const { data: created } = await supabase
      .from('agent_profiles')
      .select('slug')
      .eq('id', data.id)
      .maybeSingle();
    createdSlug = created?.slug ?? null;
  }

  /*
    The CV nothing points at any more, removed the moment that becomes true.

    This ran after the developer tags below, so a tag write that failed
    returned before it and the replaced file stayed in the bucket with
    nothing referencing it. The row is the authority: once it is written,
    the old file is an orphan whatever happens next, so it goes now. Through
    the account's own session, which the storage policy confines to its own
    folder. A failure here is logged and the save stands: the row is right,
    and a stray file in a private bucket is the smaller wrong.
  */
  if (orphanedCv && isOwnStoragePath(user.id, orphanedCv)) {
    const { error: removeError } = await supabase.storage.from(CV_BUCKET).remove([orphanedCv]);
    if (removeError) logFailure('profile', 'could not remove the replaced CV', { user: user.id });
  }

  /*
    The developer tags, changed by difference rather than replaced.

    This used to delete every row and insert the new set, with neither result
    checked. PostgREST has no transaction spanning two calls, so a failed
    insert — a developer id that no longer exists, a connection dropped between
    the two — left the consultant with no developers at all and a screen saying
    the profile had been saved. Deleting only what was removed and inserting
    only what was added means a failure changes nothing it was not asked to
    change, and the errors are now reported rather than dropped.
  */
  if (agentId) {
    const { data: currentRows } = await supabase
      .from('agent_developers')
      .select('developer_id')
      .eq('agent_id', agentId);

    const current = new Set((currentRows ?? []).map((row) => row.developer_id));
    const wanted = new Set(parsed.data.developerIds);
    const removed = [...current].filter((id) => !wanted.has(id));
    const added = [...wanted].filter((id) => !current.has(id));

    if (removed.length) {
      const { error } = await supabase
        .from('agent_developers')
        .delete()
        .eq('agent_id', agentId)
        .in('developer_id', removed);
      if (error) return { ok: false, error: error.message };
    }

    if (added.length) {
      const { error } = await supabase.from('agent_developers').insert(
        added.map((developerId) => ({
          agent_id: agentId!,
          developer_id: developerId,
        })),
      );
      if (error) return { ok: false, error: error.message };
    }
  }

  // Two different events, and only one of them can be true on a given save.
  //
  // Visibility is compared against what was there rather than sent on every
  // save: this form is where a consultant edits their headline, and a "your
  // visibility changed" email every time they fix a typo is exactly the kind
  // of noise that gets a sender muted.
  if (createdSlug) {
    const slug = createdSlug;
    after(() => notifyProfileReady(user.id, slug, parsed.data.visibility));
  } else if (existing && existing.visibility !== parsed.data.visibility) {
    after(() => notifyVisibilityChanged(user.id, parsed.data.visibility));
  }

  revalidatePath('/dashboard/profile');
  revalidatePath('/agents');
  return { ok: true };
}
