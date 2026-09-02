import 'server-only';

/**
 * Paymob's three-step checkout.
 *
 * Their flow is: authenticate for a short-lived token, register an order,
 * then exchange both for a payment key that an iframe accepts. Three round
 * trips before the buyer sees a card form, which is why this runs once when
 * the button is pressed rather than on the billing page load.
 *
 * Nothing here is verified against the live API — the account credentials do
 * not exist yet. It is written to Paymob's documented contract, and the parts
 * that carry the risk (signature checking, granting credits exactly once) are
 * tested independently of it.
 */

const BASE = 'https://accept.paymob.com/api';

export type PaymobConfig = {
  apiKey: string;
  integrationId: string;
  iframeId: string;
};

export function paymobConfig(): PaymobConfig | null {
  const apiKey = process.env.PAYMOB_API_KEY;
  const integrationId = process.env.PAYMOB_INTEGRATION_ID;
  const iframeId = process.env.PAYMOB_IFRAME_ID;

  if (!apiKey || !integrationId || !iframeId) return null;
  return { apiKey, integrationId, iframeId };
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      `paymob ${path} -> ${response.status}: ${await response.text().catch(() => '<unreadable>')}`,
    );
  }

  return response.json();
}

/**
 * Paymob wants every billing field present, and rejects the request outright
 * if one is missing. "NA" is their own documented filler for fields a merchant
 * does not collect — and this merchant deliberately does not collect a home
 * address to sell a job posting.
 */
function billingData(email: string, name: string, phone: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return {
    email,
    first_name: first || 'NA',
    last_name: rest.join(' ') || 'NA',
    phone_number: phone,
    apartment: 'NA',
    floor: 'NA',
    street: 'NA',
    building: 'NA',
    shipping_method: 'NA',
    postal_code: 'NA',
    city: 'NA',
    state: 'NA',
    country: 'EG',
  };
}

export async function createCheckout(args: {
  config: PaymobConfig;
  /** Our order id. Comes back on the callback as merchant_order_id. */
  merchantOrderId: string;
  amountEgp: number;
  buyerEmail: string;
  buyerName: string;
  buyerPhone: string;
}): Promise<{ iframeUrl: string; paymobOrderId: string }> {
  const auth = (await post('/auth/tokens', { api_key: args.config.apiKey })) as { token: string };

  // Paymob works in piastres. Sending pounds would undercharge by 100x.
  const amountCents = Math.round(args.amountEgp * 100);

  const order = (await post('/ecommerce/orders', {
    auth_token: auth.token,
    delivery_needed: false,
    amount_cents: amountCents,
    currency: 'EGP',
    merchant_order_id: args.merchantOrderId,
    items: [],
  })) as { id: number };

  const key = (await post('/acceptance/payment_keys', {
    auth_token: auth.token,
    amount_cents: amountCents,
    expiration: 3600,
    order_id: order.id,
    billing_data: billingData(args.buyerEmail, args.buyerName, args.buyerPhone),
    currency: 'EGP',
    integration_id: Number(args.config.integrationId),
  })) as { token: string };

  return {
    iframeUrl: `${BASE}/acceptance/iframes/${args.config.iframeId}?payment_token=${key.token}`,
    paymobOrderId: String(order.id),
  };
}
