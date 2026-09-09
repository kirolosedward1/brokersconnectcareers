'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { COMPANY_LOGOS_BUCKET } from '@/lib/storage';
import { buildCompanySlug } from '@/lib/slug';
import { withUniqueSlug } from '@/lib/actions/unique-slug';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';

const schema = z.object({
  nameAr: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().max(160).optional().nullable(),
  aboutAr: z.string().trim().max(2000).optional().nullable(),
  aboutEn: z.string().trim().max(2000).optional().nullable(),
  website: z.string().trim().url().max(200).optional().nullable().or(z.literal('')),
  headcountBand: z.enum(HEADCOUNT_BANDS).optional().nullable(),
  districtId: z.coerce.number().int().positive().optional().nullable(),
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
  };

  // Through membership, not ownership. Keyed on owner_id this returned null for
  // a recruiter, who then fell through to the create branch below and made
  // themselves a second, empty company instead of editing the one they belong
  // to. Membership finds the company they are actually in; RLS decides whether
  // they may change it.
  const { data: existing } = await supabase.rpc('my_company_id');

  if (existing) {
    // The slug is deliberately not regenerated on rename — it is a public URL
    // that other sites may already link to.
    const { data: saved, error } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', existing)
      .select('id');

    if (error) return { ok: false, error: error.message };
    // companies_update_own is admin-only, so a recruiter reaches zero rows
    // rather than an error, and was previously told it saved.
    if (!saved?.length) return { ok: false, error: 'forbidden' };

    revalidatePath('/employer/company');
    return { ok: true, data: { id: existing } };
  }

  const { data, error } = await withUniqueSlug<{ id: string }>(
    () => buildCompanySlug(parsed.data.nameEn || parsed.data.nameAr),
    (slug) =>
      supabase.from('companies').insert({ owner_id: user.id, slug, ...payload }).select('id').single(),
  );

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

  // Storage RLS already confines uploads to the owner's own company folder;
  // this check keeps a crafted request from pointing the row somewhere else.
  if (!parsed.data.storagePath.startsWith(`${parsed.data.companyId}/`)) {
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

  const admin = createAdminClient();
  const { data: found } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const match = found?.users.find(
    (candidate) => candidate.email?.toLowerCase() === parsed.data.email.toLowerCase(),
  );
  if (!match) return { ok: false, error: 'no_account' };
  if (match.id === user.id) return { ok: false, error: 'already_member' };

  const { error } = await supabase
    .from('company_members')
    .insert({ company_id: companyId, user_id: match.id, role: parsed.data.role });

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'already_member' };
    if (error.message.includes('company_member_role')) return { ok: false, error: 'not_employer' };
    return { ok: false, error: 'forbidden' };
  }

  revalidatePath('/employer/company');
  return { ok: true };
}

export async function removeCompanyMember(userId: string): Promise<ActionResult> {
  const supabase = await createClient();
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
