import { mobileJson, publicRead } from '@/lib/mobile-api/http';
import { getCompanyBySlug, getCompanyOpenJobs } from '@/lib/queries/companies';
import type { CompanyPageResponse } from '@/lib/mobile-api/reads';

/**
 * GET /api/mobile/v1/companies/<slug> — a company's public page and its live
 * listings.
 *
 * Only the columns the website's company page shows: the row itself also
 * carries the owner and the credit balance, which are nobody's business here.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ slug: string }> };

export const GET = publicRead<Context>(async (_request, { params }) => {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return mobileJson({ error: 'not_found' }, { status: 404 });

  const company = await getCompanyBySlug(slug);
  if (!company) return mobileJson({ error: 'not_found' }, { status: 404 });

  const { jobs, total } = await getCompanyOpenJobs(company.id);

  return {
    company: {
      id: company.id,
      slug: company.slug,
      name_ar: company.name_ar,
      name_en: company.name_en,
      logo_url: company.logo_url,
      about_ar: company.about_ar,
      about_en: company.about_en,
      website: company.website,
      headcount_band: company.headcount_band,
      company_type: company.company_type,
      verification_status: company.verification_status,
      verified_at: company.verified_at,
      district: company.district,
    },
    jobs,
    total,
  } satisfies CompanyPageResponse;
});
