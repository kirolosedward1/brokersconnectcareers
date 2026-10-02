import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, ExternalLink, FilePen, Lock, RotateCcw, Star, StarOff, X, EyeOff } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { NoteForm } from '@/components/admin/note-form';
import { JobStatusBadge, ReportStatusBadge, VerificationBadge } from '@/components/admin/badges';
import { Facts, PageHeader, Section, Trail } from '@/components/admin/kit';
import { CompanySignalList, SafetyFlags } from '@/components/admin/safety';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { UUID_RE } from '@/lib/admin/params';
import { jobIsLive } from '@/lib/job-state';
import { formatDate, formatEgp, formatNumber } from '@/lib/utils';
import type {
  AdminAuditRow,
  ApplicationStatus,
  JobRow,
  ModerationNoteRow,
  ReportReason,
  ReportStatus,
  VerificationStatus,
} from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('jobsQueue'), robots: { index: false, follow: false } };
}

const STAGES: ApplicationStatus[] = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

type JobDetail = JobRow & {
  company: {
    id: string;
    name_ar: string;
    name_en: string | null;
    slug: string;
    verification_status: VerificationStatus;
    suspended_at?: string | null;
    post_credits: number;
  };
  district: { name_ar: string; name_en: string } | null;
};

type JobReport = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: { id: string; full_name: string } | null;
};

/**
 * One listing, and the moderation decisions its state allows.
 *
 * The buttons offered are exactly the transitions admin_moderate_job accepts
 * from where the listing is now — there is no button here the database would
 * refuse, and if somebody else moved it first the refusal says so and the page
 * re-reads. Applications appear as counts per stage: investigating a listing
 * does not need the applicants' names, and the application pages have them
 * when a case does.
 */
export default async function AdminJobPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const job = must(
    await supabase
      .from('jobs')
      .select(
        '*, company:companies (id, name_ar, name_en, slug, verification_status, suspended_at, post_credits), district:districts (name_ar, name_en)',
      )
      .eq('id', id)
      .maybeSingle(),
    'loading a listing',
  ).data as unknown as JobDetail | null;
  if (!job) notFound();

  const stageCounts = STAGES.map((stage) =>
    supabase.from('applications').select('id', { count: 'exact', head: true }).eq('job_id', id).eq('status', stage),
  );

  const [reports, audit, notes, signals, ...stages] = await Promise.all([
    supabase
      .from('reports')
      .select('id, reason, detail, status, created_at, reporter:profiles!reports_reporter_id_fkey (id, full_name)')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('admin_audit_log').select('*').eq('target_type', 'job').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('moderation_notes').select('*').eq('target_type', 'job').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.rpc('admin_job_signals', { p_jobs: [id] }),
    ...stageCounts,
  ]);

  const complaints = must(reports, 'loading reports').data as unknown as JobReport[];
  const trail = must(audit, 'loading the record').data as AdminAuditRow[];
  const noteRows = must(notes, 'loading notes').data as ModerationNoteRow[];
  const review = (must(signals, 'loading review signals').data ?? [])[0];
  const counts = stages.map((result, index) => ({ stage: STAGES[index], count: must(result, 'counting applications').count }));
  const totalApplications = counts.reduce((sum, c) => sum + c.count, 0);

  const t = await getTranslations('admin');
  const tTrack = await getTranslations('track');
  const tEmployment = await getTranslations('employmentType');
  const tExperience = await getTranslations('experienceBand');
  const tLeads = await getTranslations('leadsSource');
  const tCommission = await getTranslations('commissionType');
  const tCompensation = await getTranslations('compensation');
  const tApplication = await getTranslations('applicationStatus');
  const tReason = await getTranslations('reportReason');
  const tCommon = await getTranslations('common');
  const tForm = await getTranslations('jobForm');

  const title = localized(locale, job.title_ar, job.title_en);
  /*
    Every text a reader of the listing is shown, each under its field's name.
    The commission note is on every visitor's page, and the English title and
    description on every English reader's; showing the moderator only the
    Arabic description and requirements had them approve text they were never
    shown — and an edit to any of these sends a live listing back to review
    (migration 327) precisely so that somebody reads it.
  */
  const texts = [
    { label: tForm('titleAr'), value: job.title_ar },
    { label: tForm('titleEn'), value: job.title_en },
    { label: tForm('descriptionAr'), value: job.description_ar },
    { label: tForm('descriptionEn'), value: job.description_en },
    { label: tForm('requirementsAr'), value: job.requirements_ar },
    { label: tForm('commissionNote'), value: job.commission_note_ar },
  ].filter((text): text is { label: string; value: string } => Boolean(text.value?.trim()));
  const live = jobIsLive(job);
  const openReports = complaints.filter((r) => r.status === 'open' || r.status === 'investigating').length;

  const salary =
    job.basic_salary_min != null || job.basic_salary_max != null ? (
      <span>
        <span className="numeral">
          {job.basic_salary_min != null ? formatEgp(job.basic_salary_min, locale) : '…'}
          {' – '}
          {job.basic_salary_max != null ? formatEgp(job.basic_salary_max, locale) : '…'}
        </span>{' '}
        {tCommon('egp')}
      </span>
    ) : (
      tCompensation('noBasicSalary')
    );

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/admin/jobs', label: t('jobsQueue') }}
        title={title}
        lede={localized(locale, job.company.name_ar, job.company.name_en)}
        actions={
          <>
            <JobStatusBadge status={job.status} expiresAt={job.expires_at} />
            {job.status !== 'draft' ? (
              <Link href={`/jobs/${job.slug}`} className="inline-flex min-h-8 items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="size-3.5" aria-hidden />
                {t('publicPage')}
              </Link>
            ) : null}
          </>
        }
      />

      {job.rejection_note && job.status === 'rejected' ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive-muted px-4 py-3 text-sm text-destructive">
          {t('rejectionNoteShown')} «{job.rejection_note}»
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="space-y-5">
          <Section title={t('listingDetails')}>
            <Facts
              items={[
                { label: t('track'), value: tTrack(job.track) },
                { label: t('employmentType'), value: tEmployment(job.employment_type) },
                { label: t('experience'), value: tExperience(job.experience_band) },
                { label: t('district'), value: job.district ? localized(locale, job.district.name_ar, job.district.name_en) : '—' },
                { label: tCompensation('basicSalary'), value: salary },
                {
                  label: tCompensation('commission'),
                  value:
                    job.commission_type === 'percentage' && job.commission_value != null
                      ? tCompensation.rich('commissionPercent', {
                          value: String(job.commission_value),
                          v: (chunks) => <span className="numeral">{chunks}</span>,
                        })
                      : tCommission(job.commission_type),
                },
                { label: t('leads'), value: tLeads(`${job.leads_source}_short`) },
                { label: t('seats'), value: <span className="numeral">{formatNumber(job.seats, locale)}</span> },
                { label: t('createdAt'), value: formatDate(job.created_at, locale) },
                { label: t('publishedAt'), value: job.published_at ? formatDate(job.published_at, locale) : '—' },
                { label: t('colExpires'), value: job.expires_at ? formatDate(job.expires_at, locale) : '—' },
                { label: t('views'), value: <span className="numeral">{formatNumber(job.view_count, locale)}</span> },
              ]}
            />
            {/* Open while it waits for a decision: the text is what is being decided on. */}
            <details className="mt-4 text-sm" open={job.status === 'pending_review'}>
              <summary className="cursor-pointer text-primary">{t('fullDescription')}</summary>
              <dl className="mt-2 space-y-3">
                {texts.map((text) => (
                  <div key={text.label}>
                    <dt className="text-xs font-medium text-muted-foreground">{text.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-line leading-relaxed" dir="auto">
                      {text.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </Section>

          <Section
            title={t('applicationsCount', { count: formatNumber(totalApplications, locale) })}
            actions={
              totalApplications ? (
                <Link href={`/admin/applications?job=${job.id}`} className="text-xs text-primary hover:underline">
                  {t('seeAll')}
                </Link>
              ) : null
            }
          >
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {counts.map(({ stage, count }) => (
                <div key={stage} className="rounded-lg bg-muted/50 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{tApplication(stage)}</dt>
                  <dd className="numeral text-lg font-semibold">{formatNumber(count, locale)}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title={t('reportsOnListing')}>
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
              <NoteForm targetType="job" targetId={job.id} />
              <Trail audit={trail} notes={noteRows} locale={locale} />
            </div>
          </Section>
        </div>

        <aside className="order-first space-y-5 lg:order-none">
          <Section title={t('moderation')}>
            <div className="flex flex-wrap gap-2">
              {job.status === 'pending_review' ? (
                <>
                  <ConfirmAction
                    lever={{ do: 'job', jobId: job.id, action: 'approve', version: job.version }}
                    label={t('approve')}
                    title={t('approveListingTitle')}
                    body={t('approveListingBody')}
                    variant="success"
                    icon={<Check aria-hidden />}
                  />
                  <ConfirmAction
                    lever={{ do: 'job', jobId: job.id, action: 'request_changes', version: job.version }}
                    label={t('requestChanges')}
                    title={t('requestChanges')}
                    body={t('requestChangesListingBody')}
                    reason="required"
                    reasonLabel={t('reasonToCompany')}
                    icon={<FilePen aria-hidden />}
                  />
                  <ConfirmAction
                    lever={{ do: 'job', jobId: job.id, action: 'reject', version: job.version }}
                    label={t('reject')}
                    title={t('rejectListingTitle')}
                    body={t('rejectListingBody')}
                    reason="required"
                    reasonLabel={t('reasonToCompany')}
                    variant="destructive"
                    icon={<X aria-hidden />}
                  />
                </>
              ) : null}

              {job.status === 'active' ? (
                <ConfirmAction
                  lever={{ do: 'job', jobId: job.id, action: 'unpublish' }}
                  label={t('unpublish')}
                  title={t('unpublishTitle')}
                  body={t('unpublishBody')}
                  reason="required"
                  reasonLabel={t('reasonToCompany')}
                  variant="destructive"
                  icon={<EyeOff aria-hidden />}
                />
              ) : null}

              {job.status === 'active' || job.status === 'expired' ? (
                <ConfirmAction
                  lever={{ do: 'job', jobId: job.id, action: 'close' }}
                  label={t('closeListing')}
                  title={t('closeListing')}
                  body={t('closeListingBody')}
                  reason="required"
                  icon={<Lock aria-hidden />}
                />
              ) : null}

              {job.status === 'rejected' ? (
                <ConfirmAction
                  lever={{ do: 'job', jobId: job.id, action: 'restore', version: job.version }}
                  label={t('restoreListing')}
                  title={t('restoreListing')}
                  body={t('restoreListingBody')}
                  variant="success"
                  icon={<RotateCcw aria-hidden />}
                />
              ) : null}

              {live ? (
                <ConfirmAction
                  lever={{ do: 'feature', jobId: job.id, featured: !job.is_featured }}
                  label={job.is_featured ? t('unfeature') : t('feature')}
                  title={job.is_featured ? t('unfeature') : t('feature')}
                  body={job.is_featured ? undefined : t('featureBody')}
                  variant="ghost"
                  icon={job.is_featured ? <StarOff aria-hidden /> : <Star aria-hidden />}
                />
              ) : null}

              {job.status === 'draft' || job.status === 'closed' ? (
                <p className="text-sm text-muted-foreground">
                  {job.status === 'draft' ? t('draftNoLever') : t('closedNoLever')}
                </p>
              ) : null}
            </div>
          </Section>

          {/* What the listing says, and what its company has been doing, that a
              moderator should weigh before deciding. Facts, not verdicts. */}
          <Section title={t('safetyHeading')}>
            <div className="space-y-3">
              <SafetyFlags flags={review?.flags ?? []} empty />
              <CompanySignalList signals={review?.company_signals ?? null} locale={locale} empty />
            </div>
          </Section>

          <Section title={t('company')}>
            <div className="space-y-2 text-sm">
              <Link href={`/admin/companies/${job.company.id}`} className="font-medium hover:text-primary hover:underline">
                {localized(locale, job.company.name_ar, job.company.name_en)}
              </Link>
              <div>
                <VerificationBadge status={job.company.verification_status} suspended={Boolean(job.company.suspended_at)} />
              </div>
              <Link href={`/admin/jobs?status=all&company=${job.company.id}`} className="block text-xs text-primary hover:underline">
                {t('allCompanyListings')}
              </Link>
            </div>
          </Section>

          {openReports ? (
            <Section title={t('reports')}>
              <p className="mb-2 text-sm">{t('reportCount', { count: openReports })}</p>
              <Link href="/admin/reports?type=job" className="text-sm text-primary hover:underline">
                {t('openReportsQueue')}
              </Link>
            </Section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
