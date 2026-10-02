/*
  No server imports: startCheckout passes in the reads it makes with the
  caller's session, and scripts/checkout-access.test.mjs passes in fakes.
*/

type Answer<T> = PromiseLike<{ data: T | null; error: unknown }>;

/** What startCheckout reads, through the caller's own session. */
export type CheckoutReads = {
  /** my_company_id(): the company the caller owns or belongs to. */
  myCompanyId(): Answer<string>;
  /** That company's row, which RLS shows only to its own people. */
  company(id: string): Answer<{ id: string; name_ar: string }>;
  /** is_company_admin(target). */
  isCompanyAdmin(companyId: string): Answer<boolean>;
  /** The caller's own profile. */
  standing(): Answer<{ approval_status: string }>;
};

export type CheckoutAccess =
  | { ok: true; company: { id: string; name_ar: string } }
  | { ok: false; error: 'failed' | 'no_company' | 'forbidden' };

/**
 * Whether the signed-in person may buy for a company, and which.
 *
 * Through membership, so a colleague buying credits for the company they work
 * at is not told they have no company. Buying is a company admin's act, from
 * an account in good standing: the order row is written with the service role
 * afterwards, so the caller's standing has to be established here.
 *
 * A read that failed is not an answer. It is `failed`, which the button shows
 * as "try again"; `no_company` and `forbidden` tell the person who may buy and
 * that trying again changes nothing (buy-pack-button.tsx), so a database that
 * timed out must not say them to the company's own approved admin.
 */
export async function checkoutAccess(reads: CheckoutReads): Promise<CheckoutAccess> {
  const companyId = await reads.myCompanyId();
  if (companyId.error) return { ok: false, error: 'failed' };
  if (!companyId.data) return { ok: false, error: 'no_company' };

  const company = await reads.company(companyId.data);
  if (company.error) return { ok: false, error: 'failed' };
  if (!company.data) return { ok: false, error: 'no_company' };

  const [admin, standing] = await Promise.all([reads.isCompanyAdmin(company.data.id), reads.standing()]);
  if (admin.error || standing.error) return { ok: false, error: 'failed' };
  if (!admin.data || standing.data?.approval_status !== 'approved') return { ok: false, error: 'forbidden' };

  return { ok: true, company: company.data };
}
