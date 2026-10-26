import { readCompanyPrivate } from '@/lib/company-member';
import { mobileJson, withMobileAuth } from '@/lib/mobile-api/http';
import type { CompanyPrivate } from '@/lib/mobile-api/reads';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/mobile/v1/company — the caller's company, the part that is not public.
 *
 * The owner, the credit balance, and whether the company is suspended.
 * my_company_private() answers only for a member of my_company_id()'s company;
 * a stranger, and a signed-in person with no company, gets nothing (404).
 *
 * The app's viewer calls that function itself (session.tsx), the same way it
 * calls my_company_id(), so the account still loads when this website is down.
 * This route is the same answer for a client that speaks only this API.
 */
export const dynamic = 'force-dynamic';

export const GET = withMobileAuth(async () => {
  const supabase = await createClient();
  const { data: companyId, error } = await supabase.rpc('my_company_id');
  if (error) throw error;
  if (!companyId) return mobileJson({ error: 'not_found' }, { status: 404 });

  const priv = await readCompanyPrivate(supabase, companyId);
  if (!priv) return mobileJson({ error: 'not_found' }, { status: 404 });
  return mobileJson(priv satisfies CompanyPrivate);
});
