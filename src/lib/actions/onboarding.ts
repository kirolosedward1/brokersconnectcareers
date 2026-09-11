'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { normalisePhone } from '@/lib/phone';
import { buildAgentSlug, buildCompanySlug } from '@/lib/slug';
import { withUniqueSlug } from '@/lib/actions/unique-slug';
import { HEADCOUNT_BANDS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';
import { after } from 'next/server';
import { notifyWelcome } from '@/lib/email/notify';

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

  /*
    A consultant's directory profile, created here for the same reason the
    company below is.

    The directory joins agent_profiles, so a candidate without a row is not
    merely an empty profile — they are absent from /agents entirely, and stay
    absent until they find the profile form and save it. Every consultant in
    the seed had a row because the seed script wrote one; the first real signup
    did not, and could not be found by any employer searching the directory.

    Visibility is left at its column default, `verified_employers_only`. So
    they appear immediately, as an anonymous card — track, districts, years,
    no name and no number — which is exactly what the profile page promises
    them, and they can widen or hide it whenever they like. Being listed is not
    the same as being identified.

    A failure here does not fail onboarding, for the same reason the company
    block gives: the account works, and /dashboard/profile can still create it.
  */
  if (parsed.data.role === 'candidate') {
    const { data: alreadyThere } = await supabase
      .from('agent_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!alreadyThere) {
      await withUniqueSlug<{ id: string }>(
        () => buildAgentSlug(parsed.data.fullName),
        (slug) =>
          supabase.from('agent_profiles').insert({ user_id: user.id, slug }).select('id').single(),
      );
    }
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

    /*
      Membership, for the reason saveCompany documents: keyed on owner_id an
      invited colleague who then completes onboarding falls through to the
      create branch and makes a second, empty company beside the one they
      already belong to.
    */
    const { data: existing } = await supabase.rpc('my_company_id');

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

  // The account exists whether or not this goes out — after() runs once the
  // response is on its way, and notifyWelcome swallows its own failures.
  after(() => notifyWelcome(user.id));

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
