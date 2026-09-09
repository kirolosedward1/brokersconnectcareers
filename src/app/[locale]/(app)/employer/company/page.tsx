import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { CompanyForm } from '@/components/employer/company-form';
import { VerificationPanel } from '@/components/employer/verification-panel';
import { LogoUpload } from '@/components/employer/logo-upload';
import { TeamSettings, type TeamMember } from '@/components/employer/team-settings';
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
  let team: TeamMember[] = [];
  let isCompanyAdmin = false;

  if (viewer.company) {
    const supabase = await createClient();
    const [{ data: docs }, { data: roster }] = await Promise.all([
      supabase
        .from('company_documents')
        .select('*')
        .eq('company_id', viewer.company.id)
        .order('created_at', { ascending: false }),
      // RLS already scopes this to companies the caller belongs to; the filter
      // is for the query planner, not for authorisation.
      supabase
        .from('company_members')
        .select('user_id, role, created_at, profile:profiles (full_name)')
        .eq('company_id', viewer.company.id)
        .order('created_at', { ascending: true }),
    ]);

    documents = (docs ?? []) as CompanyDocumentRow[];

    const rows = (roster ?? []) as unknown as {
      user_id: string;
      role: 'admin' | 'recruiter';
      profile: { full_name: string } | null;
    }[];

    team = rows.map((row) => ({
      userId: row.user_id,
      name: row.profile?.full_name ?? '—',
      role: row.role,
      isOwner: row.user_id === viewer.company!.owner_id,
    }));

    isCompanyAdmin = rows.some(
      (row) => row.user_id === viewer.userId && row.role === 'admin',
    );
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
      {/* The logo lives on the company record, which companies_update_own makes
          an admin's. Offered to a recruiter it would upload the file and then
          save nothing. */}
      {viewer.company && isCompanyAdmin ? (
        <LogoUpload
          companyId={viewer.company.id}
          companyName={localized(locale, viewer.company.name_ar, viewer.company.name_en)}
          companySlug={viewer.company.slug}
          logoUrl={viewer.company.logo_url}
        />
      ) : null}

      {isCompanyAdmin || !viewer.company ? (
        <CompanyForm locale={locale} company={viewer.company} districts={districts} />
      ) : null}

      {/* Admins only, and not out of tidiness: the commercial register and the
          tax card are an admin's since migration 24, so a recruiter opening
          this page would meet an empty panel and an upload the database
          refuses. Nothing here decides who may — this only stops offering a
          control that will say no. */}
      {viewer.company && isCompanyAdmin ? (
        <VerificationPanel
          companyId={viewer.company.id}
          status={viewer.company.verification_status}
          documents={documents}
        />
      ) : null}

      {viewer.company ? <TeamSettings members={team} canManage={isCompanyAdmin} /> : null}
    </div>
  );
}
