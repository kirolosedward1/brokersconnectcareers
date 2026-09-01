/**
 * Environment access in one place, so a missing variable fails loudly at the
 * point of use rather than as `undefined` three layers down.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
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
};

/**
 * Billing is built now and priced at zero at launch. Everything behind this
 * flag exists and is reachable; it just does not charge.
 */
export const BILLING_ENABLED = process.env.BILLING_ENABLED === 'true';
