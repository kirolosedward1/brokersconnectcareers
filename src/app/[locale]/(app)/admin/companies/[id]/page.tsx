import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ban, BadgeCheck, ExternalLink, FilePen, RotateCcw, ShieldOff, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { CompanyLogo } from '@/components/companies/company-logo';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { DocumentLink } from '@/components/admin/document-link';
import { NoteForm } from '@/components/admin/note-form';
import { ApprovalBadge, JobStatusBadge, ReportStatusBadge, VerificationBadge } from '@/components/admin/badges';
import { Facts, Num, PageHeader, Section, Trail } from '@/components/admin/kit';
import { CompanySignalList, SafetyFlags } from '@/components/admin/safety';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { UUID_RE } from '@/lib/admin/params';
import { formatDate, formatNumber } from '@/lib/utils';
import type {
  AdminAuditRow,
  ApprovalStatus,
  CompanyDocumentRow,
  CompanyMemberRole,
  CompanyRow,
  JobStatus,
  ModerationNoteRow,
  ReportReason,
  ReportStatus,
} from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('companiesQueue'), robots: { index: false, follow: false } };
}

type Member = {
  role: CompanyMemberRole;
  created_at: string;
  profile: { id: string; full_name: string; approval_status: ApprovalStatus } | null;
};

type CompanyJob = {
  id: string;
  title_ar: string;
  title_en: string | null;
  status: JobStatus;
  expires_at: string | null;
  created_at: string;
  applications: { count: number }[];
};

type CompanyReport = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: { id: string; full_name: string } | null;
};

/**
 * One company, and every lever an operator has over it.
 *
 * The papers and the verification decision, the people who act for it, the
 * listings it has put up, what readers have reported about it, and the record
 * of what admins did. The documents are private: each one opens through a
 * five-minute URL minted on request and recorded, never a link in the page.
 */
export default async function AdminCompanyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const company = must(
    await supabase.from('companies').select('*, district:districts (name_ar, name_en)').eq('id', id).maybeSingle(),
    'loading a company',
  ).data as (CompanyRow & { district: { name_ar: string; name_en: string } | null }) | null;
  if (!company) notFound();

  const [documents, members, jobs, reports, jobReports, audit, notes, moderation, signals] = await Promise.all([
    supabase.from('company_documents').select('*').eq('company_id', id).order('created_at', { ascending: false }),
    supabase
      .from('company_members')
      .select('role, created_at, profile:profiles (id, full_name, approval_status)')
      .eq('company_id', id)
      .order('created_at'),
    supabase
      .from('jobs')
      .select('id, title_ar, title_en, status, expires_at, created_at, applications (count)', { count: 'exact' })
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('reports')
      .select('id, reason, detail, status, created_at, reporter:profiles!reports_reporter_id_fkey (id, full_name)')
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('reports')
      .select('id, job:jobs!inner (company_id)', { count: 'exact', head: true })
      .eq('job.company_id', id)
      .in('status', ['open', 'investigating']),
    supabase.from('admin_audit_log').select('*').eq('target_type', 'company').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('moderation_notes').select('*').eq('target_type', 'company').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    // The suspension reason lives here since migration 327; the companies row
    // is readable by anybody, so it no longer carries it.
    supabase.from('company_moderation').select('suspension_reason').eq('company_id', id).maybeSingle(),
    supabase.rpc('admin_company_signals', { p_companies: [id] }),
  ]);

  const docs = must(documents, 'loading documents').data as CompanyDocumentRow[];
  const people = must(members, 'loading members').data as unknown as Member[];
  const listings = must(jobs, 'loading listings');
  const complaints = must(reports, 'loading reports').data as unknown as CompanyReport[];
  const openJobReports = must(jobReports, 'counting listing reports').count;
  const trail = must(audit, 'loading the record').data as AdminAuditRow[];
  const noteRows = must(notes, 'loading notes').data as ModerationNoteRow[];
  const suspensionReason = moderation.data?.suspension_reason ?? null;
  const review = (must(signals, 'loading review signals').data ?? [])[0];

  const t = await getTranslations('admin');
  const tEmployer = await getTranslations('employer');
  const tReason = await getTranslations('reportReason');
  const tCompanyType = await getTranslations('companyType');
  const tBilling = await getTranslations('billing');
  const name = localized(locale, company.name_ar, company.name_en);
  const status = company.verification_status;
  const suspended = Boolean(company.suspended_at);
  const openComplaints = complaints.filter((r) => r.status === 'open' || r.status === 'investigating');

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/admin/companies', label: t('companiesQueue') }}
        title={name}
        lede={t('joinedOn', { date: formatDate(company.created_at, locale) })}
        actions={
          <>
            <VerificationBadge status={status} suspended={suspended} />
            <Link
              href={`/companies/${company.slug}`}
              className="inline-flex min-h-8 items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {t('publicPage')}
            </Link>
          </>
        }
      />

      {suspended ? (
        <p role="status" className="rounded-xl border border-destructive/40 bg-destructive-muted px-4 py-3 text-sm text-destructive">
          {t('companySuspendedBanner', { date: formatDate(company.suspended_at!, locale) })}
          {suspensionReason ? ` «${suspensionReason}»` : null}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="space-y-5">
          <Section title={t('companyDetails')}>
            <div className="flex items-start gap-4">
              <CompanyLogo logoUrl={company.logo_url} seed={company.slug} name={name} size="md" />
              <Facts
                items={[
                  { label: t('nameAr'), value: company.name_ar },
                  { label: t('nameEn'), value: company.name_en },
                  { label: t('companyType'), value: company.company_type ? tCompanyType(company.company_type) : '—' },
                  { label: t('district'), value: company.district ? localized(locale, company.district.name_ar, company.district.name_en) : '—' },
                  {
                    label: t('website'),
                    value: company.website ? (
                      <a href={company.website} target="_blank" rel="noreferrer nofollow" dir="ltr" className="break-all text-primary hover:underline">
                        {company.website}
                      </a>
                    ) : null,
                  },
                  { label: tBilling('credits'), value: <Num value={company.post_credits} locale={locale} /> },
                  { label: t('verifiedAt'), value: company.verified_at ? formatDate(company.verified_at, locale) : '—' },
                  { label: t('accountId'), value: <code dir="ltr" className="text-xs break-all">{company.id}</code> },
                ]}
              />
            </div>
            {company.about_ar ? <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{company.about_ar}</p> : null}
          </Section>

          <Section title={t('verificationPapers')}>
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noDocuments')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {docs.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {doc.doc_type === 'commercial_register' ? tEmployer('commercialRegister') : tEmployer('taxCard')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(doc.created_at, locale)}
                        {doc.review_note ? ` · «${doc.review_note}»` : ''}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      <VerificationBadge status={doc.status} />
                      <DocumentLink documentId={doc.id} label={t('viewDocument')} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t('members')}>
            <ul className="divide-y divide-border">
              {people.map((member) =>
                member.profile ? (
                  <li key={member.profile.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/admin/users/${member.profile.id}`} className="font-medium hover:text-primary hover:underline">
                      {member.profile.full_name}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t(`memberRole.${member.role}`)}
                      {member.profile.id === company.owner_id ? <Badge variant="outline">{t('owner')}</Badge> : null}
                      <ApprovalBadge status={member.profile.approval_status} />
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          </Section>

          <Section
            title={t('listingsCount', { count: formatNumber(listings.count, locale) })}
            actions={
              openJobReports ? (
                <Link href="/admin/reports?type=job" className="text-xs text-destructive hover:underline">
                  {t('openListingReports', { count: formatNumber(openJobReports, locale) })}
                </Link>
              ) : null
            }
          >
            {listings.count === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noListings')}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {(listings.data as unknown as CompanyJob[]).map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/admin/jobs/${job.id}`} className="min-w-0 truncate hover:text-primary hover:underline">
                      {localized(locale, job.title_ar, job.title_en)}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t('applicantsN', { count: formatNumber(job.applications[0]?.count ?? 0, locale) })}
                      <JobStatusBadge status={job.status} expiresAt={job.expires_at} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t('reportsAbout')}>
            {complaints.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noReports')}</p>
            ) : (
              <ul className="space-y-2">
                {complaints.map((report) => (
                  <li key={report.id} className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{tReason(report.reason)}</span>
                      <ReportStatusBadge status={report.status} />
                    </div>
                    {report.detail ? <p className="mt-1 text-muted-foreground">{report.detail}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {report.reporter ? (
                        <Link href={`/admin/users/${report.reporter.id}`} className="hover:underline">
                          {report.reporter.full_name}
                        </Link>
                      ) : (
                        t('unknownActor')
                      )}{' '}
                      · {formatDate(report.created_at, locale)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t('record')}>
            <div className="space-y-4">
              <NoteForm targetType="company" targetId={company.id} />
              <Trail audit={trail} notes={noteRows} locale={locale} />
            </div>
          </Section>
        </div>

        <aside className="order-first space-y-5 lg:order-none">
          {/* What the company says about itself and what it has been doing
              that deserves a second look. Facts for review, never verdicts. */}
          <Section title={t('safetyHeading')}>
            <div className="space-y-3">
              <SafetyFlags flags={review?.flags ?? []} empty />
              <CompanySignalList signals={review?.signals ?? null} locale={locale} empty />
            </div>
          </Section>

          <Section title={t('verification.title')}>
            <div className="flex flex-wrap gap-2">
              {status !== 'verified' ? (
                <ConfirmAction
                  lever={{ do: 'company', companyId: company.id, decision: 'verify', version: company.version }}
                  label={t('verify')}
                  title={t('verifyCompanyTitle', { name })}
                  body={docs.some((d) => d.status === 'pending') ? t('verifyCompanyBody') : t('verifyWithoutPapers')}
                  reason="optional"
                  variant="success"
                  icon={<BadgeCheck aria-hidden />}
                />
              ) : null}
              {status === 'pending' ? (
                <ConfirmAction
                  lever={{ do: 'company', companyId: company.id, decision: 'request_changes', version: company.version }}
                  label={t('requestChanges')}
                  title={t('requestChanges')}
                  body={t('requestChangesCompanyBody')}
                  reason="required"
                  reasonLabel={t('reasonToCompany')}
                  icon={<FilePen aria-hidden />}
                />
              ) : null}
              {status === 'pending' || status === 'unverified' ? (
                <ConfirmAction
                  lever={{ do: 'company', companyId: company.id, decision: 'reject', version: company.version }}
                  label={t('reject')}
                  title={t('rejectVerification')}
                  body={t('rejectVerificationBody')}
                  reason="required"
                  reasonLabel={t('reasonToCompany')}
                  variant="destructive"
                  icon={<X aria-hidden />}
                />
              ) : null}
              {status === 'verified' ? (
                <ConfirmAction
                  lever={{ do: 'company', companyId: company.id, decision: 'revoke' }}
                  label={t('revokeVerification')}
                  title={t('revokeVerification')}
                  body={t('revokeVerificationBody')}
                  reason="required"
                  variant="destructive"
                  icon={<ShieldOff aria-hidden />}
                />
              ) : null}
            </div>
          </Section>

          <Section title={t('suspension')}>
            <p className="mb-3 text-sm text-muted-foreground">
              {suspended ? t('restoreCompanyHint') : t('suspendCompanyHint')}
            </p>
            {suspended ? (
              <ConfirmAction
                lever={{ do: 'suspendCompany', companyId: company.id, suspend: false }}
                label={t('restoreCompany')}
                title={t('restoreCompany')}
                body={t('restoreCompanyBody')}
                reason="required"
                variant="success"
                icon={<RotateCcw aria-hidden />}
              />
            ) : (
              <ConfirmAction
                lever={{ do: 'suspendCompany', companyId: company.id, suspend: true }}
                label={t('suspendCompany')}
                title={t('suspendCompanyTitle', { name })}
                body={t('suspendCompanyBody')}
                reason="required"
                reasonLabel={t('reasonToCompany')}
                variant="destructive"
                icon={<Ban aria-hidden />}
              />
            )}
          </Section>

          {openComplaints.length ? (
            <Section title={t('reports')}>
              <p className="mb-3 text-sm">{t('reportCount', { count: openComplaints.length })}</p>
              <Link href="/admin/reports?type=company" className="text-sm text-primary hover:underline">
                {t('openReportsQueue')}
              </Link>
            </Section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
