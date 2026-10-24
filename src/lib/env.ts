/**
 * Environment access in one place, so a missing variable fails loudly at the
 * point of use rather than as `undefined` three layers down.
 */

/**
 * A value that is present but has not been filled in yet.
 *
 * `.env.vercel.local` ships the secret variables as REPLACE_ME placeholders so
 * the whole set imports in one go. Without this, importing that file unedited
 * would be the worst of both states: every `Boolean(process.env.X)` check reads
 * true, so /api/health and the banner on /admin/email both report configured —
 * while Resend answers 401 and Supabase refuses the key. Silent, which is
 * exactly the failure that let a production signup send no welcome email for
 * weeks.
 *
 * Treated as absent instead, so an unedited import is indistinguishable from
 * not having imported, and every check that already names the missing
 * variables keeps naming them.
 */
export function isPlaceholder(value: string | undefined): boolean {
  return !value || value.startsWith('REPLACE_ME');
}

/** The value, or undefined if it is missing or still a placeholder. */
export function configuredValue(value: string | undefined): string | undefined {
  return isPlaceholder(value) ? undefined : value;
}

function required(name: string, value: string | undefined): string {
  if (isPlaceholder(value)) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value as string;
}

export const env = {
  get supabaseUrl() {
    return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  /**
   * `||`, not `??`. A variable declared in a hosting dashboard and left blank
   * arrives as an empty string, not as undefined — which production proved by
   * serving `Sitemap: /sitemap.xml` and `<loc>/</loc>`, both invalid, because
   * an empty NEXT_PUBLIC_SITE_URL beat the VERCEL_URL fallback that exists
   * precisely so this cannot happen.
   */
  get siteUrl() {
    return (
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
    ).replace(/\/$/, '');
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? '';
  },
  /**
   * Where a reply to an email goes, and the address the footer names.
   *
   * Optional, and unset by default. Set it and every message says the reader
   * can reply or write there (and the send sets Reply-To to the same address).
   * Leave it unset and the footer stays a neutral line, with no address and
   * no instruction not to reply.
   */
  get supportEmail() {
    return process.env.SUPPORT_EMAIL ?? '';
  },
  /**
   * A copy of the broker approval and withdrawal notices, for the person who
   * runs the platform. Optional. Unset, blank, or a placeholder sends no copy.
   * Not the public support address and not a Reply-To.
   */
  get ownerNotifyEmail() {
    return process.env.OWNER_NOTIFY_EMAIL ?? '';
  },
};

/**
 * Billing is built now and priced at zero at launch. Everything behind this
 * flag exists and is reachable; it just does not charge.
 *
 * Not to be switched on until the owner has decided, and the site says, what a
 * company is buying: the prices in POST_PACKS are a hypothesis, they say
 * nothing about VAT, there is no refund policy beyond "billing is off", and
 * a pack's seat tier is not enforced when a listing is published (any credit
 * publishes any number of seats). See docs/legal.md, "Before billing opens".
 */
export const BILLING_ENABLED = process.env.BILLING_ENABLED === 'true';
