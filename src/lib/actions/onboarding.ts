'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { normalisePhone } from '@/lib/phone';
import type { ActionResult } from '@/lib/actions/jobs';

const schema = z.object({
  role: z.enum(['candidate', 'employer']),
  fullName: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(6).max(24),
  locale: z.enum(['ar', 'en']),
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
    if (error.code === '23505') return { ok: true, data: { role: parsed.data.role } };
    return { ok: false, error: error.message };
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
