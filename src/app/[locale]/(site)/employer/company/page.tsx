import { setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { CompanyForm } from '@/components/employer/company-form';
import { VerificationPanel } from '@/components/employer/verification-panel';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts } from '@/lib/queries/taxonomy';
import type { CompanyDocumentRow } from '@/lib/supabase/database.types';

export default async function EmployerCompanyPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const districts = await getDistricts();

  let documents: CompanyDocumentRow[] = [];
  if (viewer.company) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('company_documents')
      .select('*')
      .eq('company_id', viewer.company.id)
      .order('created_at', { ascending: false });
    documents = (data ?? []) as CompanyDocumentRow[];
  }

  return (
    <div className="space-y-8">
      <CompanyForm locale={locale} company={viewer.company} districts={districts} />

      {viewer.company ? (
        <VerificationPanel
          companyId={viewer.company.id}
          status={viewer.company.verification_status}
          documents={documents}
        />
      ) : null}
    </div>
  );
}
