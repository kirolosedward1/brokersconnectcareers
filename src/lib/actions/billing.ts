'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BILLING_ENABLED } from '@/lib/env';
import { POST_PACKS } from '@/lib/taxonomy';
import { createCheckout, paymobConfig } from '@/lib/paymob/client';
import type { ActionResult } from '@/lib/actions/jobs';

const schema = z.object({
  packKey: z.enum(['single', 'bulk', 'mass_hiring', 'featured_addon']),
});

/**
 * Start a purchase.
 *
 * The price is never taken from the request. The client sends a pack key, and
 * the amount, the credits and the seat tier are all read from POST_PACKS on
 * the server — otherwise the cheapest possible attack on this endpoint is to
 * post the same key with a different number attached to it.
 *
 * The pending order row is written with the service role because employers
 * deliberately have no insert policy on `orders`: a company that could create
 * its own order row could create a paid one.
 */
export async function startCheckout(input: unknown): Promise<ActionResult<{ url: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  if (!BILLING_ENABLED) return { ok: false, error: 'billing_disabled' };

  const config = paymobConfig();
  if (!config) return { ok: false, error: 'not_configured' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Through the caller's own session, so RLS confirms the company is theirs.
  const { data: company } = await supabase
    .from('companies')
    .select('id, name_ar')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!company) return { ok: false, error: 'no_company' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, whatsapp_phone')
    .eq('id', user.id)
    .maybeSingle();

  const pack = POST_PACKS.find((item) => item.key === parsed.data.packKey);
  if (!pack) return { ok: false, error: 'invalid' };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'not_configured' };
  }

  const { data: order, error } = await admin
    .from('orders')
    .insert({
      company_id: company.id,
      pack_key: pack.key,
      credits: pack.credits,
      amount_egp: pack.priceEgp,
    })
    .select('id')
    .single();

  if (error || !order) return { ok: false, error: error?.message ?? 'order_failed' };

  try {
    const checkout = await createCheckout({
      config,
      merchantOrderId: order.id,
      amountEgp: pack.priceEgp,
      buyerEmail: user.email ?? 'billing@example.com',
      buyerName: profile?.full_name ?? company.name_ar,
      buyerPhone: profile?.whatsapp_phone ?? 'NA',
    });

    // Recorded now so a callback that arrives before the buyer returns can
    // still be matched, and so an abandoned checkout is traceable.
    await admin
      .from('orders')
      .update({ paymob_order_id: checkout.paymobOrderId })
      .eq('id', order.id);

    return { ok: true, data: { url: checkout.iframeUrl } };
  } catch (cause) {
    // Leave the row as 'pending' rather than deleting it: a failed handoff to
    // the provider is worth being able to see afterwards.
    console.warn(
      '[billing] checkout failed:',
      cause instanceof Error ? cause.message : cause,
    );
    return { ok: false, error: 'checkout_failed' };
  }
}
