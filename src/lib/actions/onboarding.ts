'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { normalisePhone } from '@/lib/phone';
import { buildCompanySlug } from '@/lib/slug';
import { withUniqueSlug } from '@/lib/actions/unique-slug';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';

/**
 * A company answers more questions than a consultant does.
 *
 * Not friction for its own sake: an employer account is held for review now,
 * and a reviewer looking at a row with an email and nothing else has nothing
 * to decide on. The name is required and the rest is optional — enough to
 * review, not so much that signing up becomes a form-filling exercise before
 * anyone has seen the product.
 */
const companySchema = z.object({
  nameAr: z.string().trim().min(2).max(160),
  website: z.string().trim().max(200).optional().nullable(),
  headcountBand: z.enum(HEADCOUNT_BANDS).optional().nullable(),
  districtId: z.coerce.number().int().positive().optional().nullable(),
});

const schema = z
  .object({
    role: z.enum(['candidate', 'employer']),
    fullName: z.string().trim().min(2).max(120),
    whatsapp: z.string().trim().min(6).max(24),
    locale: z.enum(['ar', 'en']),
    company: companySchema.optional(),
  })
  .refine((value) => value.role !== 'employer' || value.company != null, {
    path: ['company'],
  });

/**
 * Creates the profile row. Until this runs, the user is authenticated but has
 * no profile — which is exactly how the rest of the app detects "not onboarded"
 * and why whatsapp_phone can stay NOT NULL in the schema.
 */
export async function completeOnboarding(input: unknown): Promise<ActionResult<{ role: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', fieldErrors: flatten(parsed.error) };
  }

  const phone = normalisePhone(parsed.data.whatsapp);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return { ok: false, error: 'invalid', fieldErrors: { whatsapp: 'invalidPhone' } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.from('profiles').insert({
    id: user.id,
    role: parsed.data.role,
    full_name: parsed.data.fullName,
    whatsapp_phone: phone,
    locale: parsed.data.locale,
    avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  });

  if (error) {
    // A duplicate key means onboarding already ran — treat it as success rather
    // than stranding the user on the form.
    if (error.code !== '23505') return { ok: false, error: error.message };
  }

  /**
   * The company is created here rather than on a page after it.
   *
   * Two reasons. An employer whose account is waiting for review should be
   * waiting on something a reviewer can actually read. And the old flow
   * dropped them onto an empty company form immediately afterwards, which is
   * the same questions asked a second time in a worse place.
   *
   * A failure here is not a failure of onboarding: the profile exists, the
   * account works, and /employer/company can still take these details. So it
   * is not reported as an error that would send them back to a form they have
   * already completed.
   */
  if (parsed.data.role === 'employer' && parsed.data.company) {
    const company = parsed.data.company;

    const { data: existing } = await supabase
      .from('companies')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();

    if (!existing) {
      await withUniqueSlug<{ id: string }>(
        () => buildCompanySlug(company.nameAr),
        (slug) =>
          supabase
            .from('companies')
            .insert({
              owner_id: user.id,
              slug,
              name_ar: company.nameAr,
              website: company.website || null,
              headcount_band: company.headcountBand || null,
              district_id: company.districtId || null,
            })
            .select('id')
            .single(),
      );
    }
  }

  return { ok: true, data: { role: parsed.data.role } };
}

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !out[key]) out[key] = 'required';
  }
  return out;
}
