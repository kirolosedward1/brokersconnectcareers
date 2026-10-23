import type { CompanyPrivate, CompanyRow } from '@/lib/supabase/database.types';

/**
 * The company a member acts for, without reading the columns that are not
 * public.
 *
 * owner_id, post_credits and suspended_at used to ride along on
 * `companies.select('*')`. That select is granted to everyone (the directory
 * policy is `using (true)`), so those three were world-readable. They now
 * come from my_company_private(), which answers only for the company
 * my_company_id() names — a member in good standing, invited recruiters
 * included, and nobody else. The public columns stay on the row.
 *
 * Until that function exists (the code can reach production first), the three
 * columns are read off the row, which the grants still allow. A later revoke
 * of those column privileges does not reach this path once the function is
 * there: the public select never names them.
 */

type QueryError = { code?: string; message?: string } | null;

/**
 * What these reads call. The website's server client and the app's client are
 * different instantiations of SupabaseClient, and TypeScript will not treat
 * one as the other, so callers pass their own and it is read through this.
 */
type Client = {
  from(relation: 'companies'): {
    select(columns: string): {
      eq(column: 'id', value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: QueryError }>;
      };
    };
  };
  rpc(fn: 'my_company_private'): PromiseLike<{ data: unknown; error: QueryError }>;
};

type PassedClient = { from: unknown; rpc: unknown };

function asClient(supabase: PassedClient): Client {
  return supabase as Client;
}

/** What a company page, a directory card and the viewer may read off `companies`. */
export const COMPANY_PUBLIC_COLUMNS =
  'id, name_ar, name_en, slug, logo_url, about_ar, about_en, website, headcount_band, company_type, district_id, verification_status, verified_at, version, created_at';

const PRIVATE_COLUMNS = 'owner_id, post_credits, suspended_at';

/**
 * The member function cannot be called yet, so the columns are read off the
 * row while the grants still allow it. PGRST202 and 42883: it has not been
 * created. 42501: this role may not execute it (insufficient privilege).
 */
export function memberReadUnavailable(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883' || error?.code === '42501';
}

/** The member function's answer, or null when it names nobody. Throws when the read failed. */
export async function readCompanyPrivate(supabase: PassedClient, companyId: string): Promise<CompanyPrivate | null> {
  const client = asClient(supabase);
  const { data, error } = await client.rpc('my_company_private');
  if (!error) return companyPrivate(data);
  if (!memberReadUnavailable(error)) throw error;

  const fallback = await client.from('companies').select(PRIVATE_COLUMNS).eq('id', companyId).maybeSingle();
  if (fallback.error) throw fallback.error;
  return companyPrivate(fallback.data);
}

/**
 * The viewer's company: public columns from the row, the private three from
 * readCompanyPrivate(). Null when the row is gone, and when my_company_private()
 * answers null — that caller has no company. Throws when a read failed, so a
 * blip is not "no company": a half-read row, with no owner and no balance,
 * would let its owner delete the account and would hide a suspension.
 */
export async function readMemberCompany(supabase: PassedClient, companyId: string): Promise<CompanyRow | null> {
  const client = asClient(supabase);
  const [row, priv] = await Promise.all([
    client.from('companies').select(COMPANY_PUBLIC_COLUMNS).eq('id', companyId).maybeSingle(),
    readCompanyPrivate(client, companyId),
  ]);
  if (row.error) throw row.error;
  if (!row.data || typeof row.data !== 'object') return null;
  if (!priv) return null;
  return { ...(row.data as CompanyRow), ...priv };
}

function companyPrivate(value: unknown): CompanyPrivate | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.owner_id !== 'string') return null;
  if (typeof row.post_credits !== 'number' || !Number.isInteger(row.post_credits)) return null;
  if (row.suspended_at != null && typeof row.suspended_at !== 'string') return null;
  return {
    owner_id: row.owner_id,
    post_credits: row.post_credits,
    suspended_at: typeof row.suspended_at === 'string' ? row.suspended_at : null,
  };
}
