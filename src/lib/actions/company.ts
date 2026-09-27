'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { COMPANY_LOGOS_BUCKET } from '@/lib/storage';
import { isOwnStoragePath } from '@/lib/storage-path';
import { buildCompanySlug } from '@/lib/slug';
import { withUniqueSlug } from '@/lib/actions/unique-slug';
import { COMPANY_TYPES, HEADCOUNT_BANDS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';
import { logFailure } from '@/lib/observe';

const schema = z.object({
  nameAr: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().max(160).optional().nullable(),
  aboutAr: z.string().trim().max(2000).optional().nullable(),
  aboutEn: z.string().trim().max(2000).optional().nullable(),
  // http(s) only. zod's .url() accepts `javascript:` and the value is rendered
  // as a link on the public company page.
  website: z
    .string()
    .trim()
    .max(200)
    .refine((value) => !value || /^https?:\/\/[^\s]+$/i.test(value), 'url')
    .optional()
    .nullable()
    .or(z.literal('')),
  headcountBand: z.enum(HEADCOUNT_BANDS).optional().nullable(),
  companyType: z.enum(COMPANY_TYPES).optional().nullable(),
  districtId: z.coerce.number().int().positive().optional().nullable(),
  /** The version the form was built from; absent when creating. */
  version: z.coerce.number().int().positive().optional(),
});

export async function saveCompany(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const payload = {
    name_ar: parsed.data.nameAr,
    name_en: parsed.data.nameEn || null,
    about_ar: parsed.data.aboutAr || null,
    about_en: parsed.data.aboutEn || null,
    website: parsed.data.website || null,
    headcount_band: parsed.data.headcountBand || null,
    district_id: parsed.data.districtId || null,
    // Only when the form carried a choice. Left out otherwise, so saving the
    // rest of the profile never clears a type somebody set, and never names a
    // column the database does not have yet (migration 67).
    /*
      Written whenever the form carried the field — a chosen type, or null for
      "unclassified", so a company that set a type can take it back. Left out
      only when the field was absent altogether (`undefined`), which is an
      older form, and an older form must not clear something it never showed.
    */
    ...(parsed.data.companyType !== undefined ? { company_type: parsed.data.companyType } : {}),
  };

  /*
    The same write again without the type, if the database has never heard of
    it.

    42703 is "no such column": code deployed ahead of migration 67. The rest of
    the profile is what the person came to save, and refusing all of it over a
    field the database cannot hold yet would be the wrong failure. Only the
    type is dropped, and only on that error.
  */
  const { company_type: _type, ...withoutType } = payload as typeof payload & {
    company_type?: unknown;
  };
  const retryWithoutType = <T extends { error: { code?: string | null } | null }>(
    first: T,
    again: () => PromiseLike<T>,
  ): PromiseLike<T> | T =>
    first.error?.code === '42703' && 'company_type' in payload ? again() : first;

  // Through membership, not ownership. Keyed on owner_id this returned null for
  // a recruiter, who then fell through to the create branch below and made
  // themselves a second, empty company instead of editing the one they belong
  // to. Membership finds the company they are actually in; RLS decides whether
  // they may change it.
  const { data: existing } = await supabase.rpc('my_company_id');

  if (existing) {
    /*
      The slug is deliberately not regenerated on rename — it is a public URL
      that other sites may already link to.

      Matched on the version the form loaded, so a second admin saving the
      company profile between this form opening and submitting is refused
      rather than overwritten. One statement, so there is no window between
      checking and writing.
    */
    const update = (values: typeof withoutType) => {
      const query = supabase.from('companies').update(values).eq('id', existing);
      return (parsed.data.version ? query.eq('version', parsed.data.version) : query).select('id');
    };

    const { data: saved, error } = await retryWithoutType(await update(payload), () =>
      update(withoutType),
    );

    if (error) return { ok: false, error: error.message };

    // companies_update_own is admin-only, so a recruiter reaches zero rows
    // rather than an error, and was previously told it saved. A version that
    // has moved reaches zero rows too, and means something different — asked,
    // rather than reported as the same refusal.
    if (!saved?.length) {
      const { data: now } = await supabase
        .from('companies')
        .select('version')
        .eq('id', existing)
        .maybeSingle();
      const moved = parsed.data.version != null && now != null && now.version !== parsed.data.version;
      return { ok: false, error: moved ? 'stale' : 'forbidden' };
    }

    revalidatePath('/employer/company');
    return { ok: true, data: { id: existing } };
  }

  const insert = (values: typeof withoutType) =>
    withUniqueSlug<{ id: string }>(
      () => buildCompanySlug(parsed.data.nameEn || parsed.data.nameAr),
      (slug) =>
        supabase.from('companies').insert({ owner_id: user.id, slug, ...values }).select('id').single(),
    );

  const { data, error } = await retryWithoutType(await insert(payload), () => insert(withoutType));

  if (error || !data) return { ok: false, error: error?.message ?? 'insert_failed' };

  revalidatePath('/employer/company');
  return { ok: true, data: { id: data.id } };
}

const logoSchema = z.object({
  companyId: z.string().uuid(),
  /** Null clears it, which is how "remove logo" is expressed. */
  storagePath: z.string().trim().min(1).max(512).nullable(),
});

/**
 * Points the company at a logo the browser has already uploaded.
 *
 * The upload itself happens client-side, straight into the public bucket
 * under the company's own folder, where a storage policy checks ownership.
 * This records the resulting public URL — the column holds a URL rather than
 * a path because the logo is rendered in places that have no session to mint
 * one with: a shared preview, a search result, an email.
 */
export async function saveCompanyLogo(input: unknown): Promise<ActionResult> {
  const parsed = logoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // The file is in this company's own folder and nowhere else. The column
  // used to take any path at all, which made it a way to point a company's
  // logo at another company's file, or at `..`.
  if (
    parsed.data.storagePath &&
    !isOwnStoragePath(parsed.data.companyId, parsed.data.storagePath)
  ) {
    return { ok: false, error: 'invalid_path' };
  }

  const { data: before } = await supabase
    .from('companies')
    .select('logo_url')
    .eq('id', parsed.data.companyId)
    .maybeSingle();

  const url = parsed.data.storagePath
    ? supabase.storage.from(COMPANY_LOGOS_BUCKET).getPublicUrl(parsed.data.storagePath).data
        .publicUrl
    : null;

  // Through the caller's session, so row-level security confirms the company
  // is theirs rather than this function taking the id on trust.
  //
  // .select() is not decoration. An update that RLS filters to zero rows comes
  // back with no error at all, so without asking what it changed this returned
  // ok for a save that saved nothing — and since migration 24 made the company
  // record admin-only, a recruiter is exactly who would meet that.
  const { data: updated, error } = await supabase
    .from('companies')
    .update({ logo_url: url })
    .eq('id', parsed.data.companyId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!updated?.length) return { ok: false, error: 'forbidden' };

  // The logo it replaced, gone — for the reason saveAvatar gives. Through the
  // caller's session, which the storage policy confines to the company's own
  // folder; a failure is logged and the save stands.
  const marker = `/storage/v1/object/public/${COMPANY_LOGOS_BUCKET}/`;
  const previousAt = before?.logo_url?.indexOf(marker) ?? -1;
  const previous =
    previousAt >= 0 ? decodeURIComponent(before!.logo_url!.slice(previousAt + marker.length).split('?')[0]) : null;
  if (
    previous &&
    previous !== parsed.data.storagePath &&
    isOwnStoragePath(parsed.data.companyId, previous)
  ) {
    const { error: removeError } = await supabase.storage.from(COMPANY_LOGOS_BUCKET).remove([previous]);
    if (removeError) logFailure('company', 'could not remove the replaced logo', { company: parsed.data.companyId });
  }

  revalidatePath('/employer/company');
  revalidatePath('/companies');
  return { ok: true };
}

const documentSchema = z.object({
  companyId: z.string().uuid(),
  docType: z.enum(['commercial_register', 'tax_card']),
  storagePath: z.string().trim().min(1).max(512),
});

/**
 * Records a verification document after the browser has uploaded it to the
 * private bucket, and moves the company into the review queue.
 */
export async function recordCompanyDocument(input: unknown): Promise<ActionResult> {
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Storage RLS already confines uploads to the owner's own company folder;
  // this keeps a crafted request from pointing the row somewhere else — and
  // exactly one file in that folder, not `<company>/../<other>/register.pdf`.
  if (!isOwnStoragePath(parsed.data.companyId, parsed.data.storagePath)) {
    return { ok: false, error: 'invalid_path' };
  }

  const { error } = await supabase.from('company_documents').insert({
    company_id: parsed.data.companyId,
    doc_type: parsed.data.docType,
    storage_path: parsed.data.storagePath,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/employer/company');
  revalidatePath('/admin/companies');
  return { ok: true };
}

/** Verified companies get one free single post per calendar month. */
export async function claimMonthlyFreePost(): Promise<ActionResult<{ claimed: boolean }>> {
  const supabase = await createClient();

  // Answered here rather than left to the RPC's own error, so an expired
  // session reaches the caller as `unauthenticated` — the one error every form
  // in this app knows how to recover from — instead of a Postgres message
  // about a policy.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data, error } = await supabase.rpc('claim_monthly_free_post');
  if (error) return { ok: false, error: error.message };

  revalidatePath('/employer/billing');
  return { ok: true, data: { claimed: Boolean(data) } };
}

// ---------------------------------------------------------------------------
// The team
// ---------------------------------------------------------------------------

const memberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['admin', 'recruiter']),
});

/**
 * Add a colleague to the company by email address.
 *
 * Adding an *existing* account only. Creating one for somebody who has never
 * signed up needs an invitation email, and no mail leaves this platform until
 * a sending domain is verified — so an invite flow built today would be a
 * button that silently does nothing. When the address is unknown the answer
 * says so and says what to do instead, which is a complete feature rather than
 * a broken half of a better one.
 *
 * The email lookup needs the service role, because profiles carries no address
 * — the addresses live in auth.users, which the anon and authenticated roles
 * cannot read. Authorisation is not delegated to that client, though: the
 * membership row is inserted through the *caller's* session, so
 * company_members_manage decides whether they may, and a recruiter trying this
 * is refused by the database rather than by this function remembering to ask.
 */
export async function addCompanyMember(input: unknown): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: companyId } = await supabase.rpc('my_company_id');
  if (!companyId) return { ok: false, error: 'no_company' };

  /*
    Before anything is looked up: the caller is an admin of this company and
    their account is in good standing.

    The lookup below runs with the service role and answers whether an email
    address has an account and, through the insert's refusal, whether it is a
    candidate's — which is the one fact a consultant on `hidden` is entitled
    to keep from an employer. It was reachable by any member, recruiters and
    accounts still awaiting approval included, before the insert policy had
    its say. The policy still decides the insert; this decides the question.
  */
  const [{ data: isAdmin }, { data: profile }] = await Promise.all([
    supabase.rpc('is_company_admin', { target: companyId }),
    supabase.from('profiles').select('approval_status').eq('id', user.id).maybeSingle(),
  ]);
  if (!isAdmin || profile?.approval_status !== 'approved') return { ok: false, error: 'forbidden' };

  /*
    Asked of the database rather than scanned for in a page of accounts.

    user_id_by_email is granted to service_role alone — the answer is whether
    an address has an account, which is not for every signed-in user to ask —
    and authorisation is unchanged: the membership row below still goes in
    through the caller's own session, so company_members_manage decides.
  */
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  const { data: invitee } = await admin.rpc('user_id_by_email', { p_email: parsed.data.email });

  if (!invitee) return { ok: false, error: 'no_account' };
  if (invitee === user.id) return { ok: false, error: 'already_member' };

  /*
    One company per account, from this door.

    my_company_id() picks an admin membership first, then the oldest, so
    adding somebody who already works for another company as an admin here
    silently switched their whole console — their listings, their applicants,
    their free post — to this company. An account that belongs to a company
    already is not one this button may claim.
  */
  const { data: elsewhere } = await admin
    .from('company_members')
    .select('company_id')
    .eq('user_id', invitee)
    .limit(1);
  if (elsewhere?.length) {
    return {
      ok: false,
      error: elsewhere[0].company_id === companyId ? 'already_member' : 'elsewhere',
    };
  }

  const { error } = await supabase
    .from('company_members')
    .insert({ company_id: companyId, user_id: invitee, role: parsed.data.role });

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'already_member' };
    if (error.message.includes('company_member_role')) return { ok: false, error: 'not_employer' };
    return { ok: false, error: 'forbidden' };
  }

  revalidatePath('/employer/company');
  return { ok: true };
}

export async function removeCompanyMember(userId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: companyId } = await supabase.rpc('my_company_id');
  if (!companyId) return { ok: false, error: 'no_company' };

  const { data: removed, error } = await supabase
    .from('company_members')
    .delete()
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .select('user_id');

  if (error) {
    // The trigger's refusal, which is the one an admin will actually meet.
    if (error.message.includes('company_owner_membership')) {
      return { ok: false, error: 'owner' };
    }
    return { ok: false, error: 'forbidden' };
  }

  // A recruiter reaches zero rows rather than an error, and would otherwise be
  // told the colleague was removed.
  if (!removed?.length) return { ok: false, error: 'forbidden' };

  revalidatePath('/employer/company');
  return { ok: true };
}
