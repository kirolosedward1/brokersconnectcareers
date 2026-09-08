import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { CompanyForm } from '@/components/employer/company-form';
import { VerificationPanel } from '@/components/employer/verification-panel';
import { LogoUpload } from '@/components/employer/logo-upload';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts } from '@/lib/queries/taxonomy';
import type { CompanyDocumentRow } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'employer' });
  return { title: t('company'), robots: { index: false, follow: false } };
}

export default async function EmployerCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
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

  const t = await getTranslations('employer');

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t('company')}</h1>
        <p className="mt-1 text-muted-foreground">{t('companyLede')}</p>
      </header>

      {/* Above the form, because it is the one field on this page that shows
          up everywhere else — the board, the directory, every listing. It
          needs a company row to attach a file to, so it waits for one. */}
      {viewer.company ? (
        <LogoUpload
          companyId={viewer.company.id}
          companyName={localized(locale, viewer.company.name_ar, viewer.company.name_en)}
          companySlug={viewer.company.slug}
          logoUrl={viewer.company.logo_url}
        />
      ) : null}

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
