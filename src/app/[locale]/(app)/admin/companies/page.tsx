import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { VerifyCompanyActions } from '@/components/admin/verify-company-actions';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import type { CompanyRow, CompanyDocumentRow } from '@/lib/supabase/database.types';

export default async function AdminCompaniesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const supabase = await createClient();

  // The queue is companies that have submitted at least one pending document.
  const { data } = await supabase
    .from('companies')
    .select('*, company_documents!inner (*)')
    .eq('company_documents.status', 'pending')
    .neq('verification_status', 'verified')
    .order('created_at', { ascending: true });

  const companies = (data ?? []) as unknown as (CompanyRow & {
    company_documents: CompanyDocumentRow[];
  })[];

  const t = await getTranslations('admin');
  const tEmployer = await getTranslations('employer');

  if (companies.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
        {t('emptyQueue')}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {companies.map((company) => (
        <li key={company.id} className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                <Link href={`/companies/${company.slug}`} className="hover:underline">
                  {localized(locale, company.name_ar, company.name_en)}
                </Link>
              </h2>
              <p className="numeral mt-1 text-sm text-muted-foreground">
                {formatDate(company.created_at, locale)}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {company.company_documents.map((document) => (
                <Badge key={document.id} variant="outline">
                  {document.doc_type === 'commercial_register'
                    ? tEmployer('commercialRegister')
                    : tEmployer('taxCard')}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <VerifyCompanyActions
              companyId={company.id}
              documentIds={company.company_documents.map((document) => document.id)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
