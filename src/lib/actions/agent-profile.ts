'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { buildAgentSlug } from '@/lib/slug';
import { withUniqueSlug } from '@/lib/actions/unique-slug';
import { normalisePhone, isValidPhone } from '@/lib/phone';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';
import { after } from 'next/server';
import { notifyProfileReady, notifyVisibilityChanged } from '@/lib/email/notify';

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(6).max(24),
  headlineAr: z.string().trim().max(160).optional().nullable(),
  headlineEn: z.string().trim().max(160).optional().nullable(),
  yearsExperience: z.coerce.number().int().min(0).max(60),
  tracks: z.array(z.enum(JOB_TRACKS)).max(6),
  districtIds: z.array(z.coerce.number().int().positive()).max(20),
  developerIds: z.array(z.coerce.number().int().positive()).max(30),
  languages: z.array(z.string().trim().max(12)).max(6),
  availability: z.enum(AVAILABILITIES),
  visibility: z.enum(['public', 'verified_employers_only', 'hidden']),
  cvPath: z.string().trim().max(512).optional().nullable(),
});

/**
 * Creates or updates the signed-in candidate's agent directory profile.
 *
 * `visibility` is the whole point of this form: an agent who is currently
 * employed can set `hidden` and disappear from the directory entirely, which is
 * what makes it safe for them to have a profile at all.
 */
export async function saveAgentProfile(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const phone = normalisePhone(parsed.data.whatsapp);
  if (!isValidPhone(phone)) {
    return { ok: false, error: 'invalid', fieldErrors: { whatsapp: 'invalidPhone' } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  if (parsed.data.cvPath && !parsed.data.cvPath.startsWith(`${user.id}/`)) {
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

  const payload = {
    headline_ar: parsed.data.headlineAr || null,
    headline_en: parsed.data.headlineEn || null,
    years_experience: parsed.data.yearsExperience,
    tracks: parsed.data.tracks,
    district_ids: parsed.data.districtIds,
    languages: parsed.data.languages,
    availability: parsed.data.availability,
    visibility: parsed.data.visibility,
    // An empty cvPath from the form means "unchanged", not "remove".
    cv_path: parsed.data.cvPath || existing?.cv_path || null,
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
