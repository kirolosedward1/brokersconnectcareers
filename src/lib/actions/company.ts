'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { buildCompanySlug } from '@/lib/slug';
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

  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (existing) {
    // The slug is deliberately not regenerated on rename — it is a public URL
    // that other sites may already link to.
    const { error } = await supabase.from('companies').update(payload).eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/employer/company');
    return { ok: true, data: { id: existing.id } };
  }

  const { data, error } = await supabase
    .from('companies')
    .insert({
      owner_id: user.id,
      slug: buildCompanySlug(parsed.data.nameEn || parsed.data.nameAr),
      ...payload,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/employer/company');
  return { ok: true, data: { id: data.id } };
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
