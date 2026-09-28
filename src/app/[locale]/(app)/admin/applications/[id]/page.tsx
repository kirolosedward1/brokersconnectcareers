import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { NoteForm } from '@/components/admin/note-form';
import { ApprovalBadge, JobStatusBadge } from '@/components/admin/badges';
import { Facts, PageHeader, Section, Trail } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { UUID_RE } from '@/lib/admin/params';
import { formatDate, formatNumber } from '@/lib/utils';
import type {
  AdminAuditRow,
  ApplicationStatus,
  ApprovalStatus,
  ExperienceBand,
  JobStatus,
  ModerationNoteRow,
  UserRole,
} from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('applications'), robots: { index: false, follow: false } };
}

type ApplicationDetail = {
  id: string;
  status: ApplicationStatus;
  note: string | null;
  decision_note: string | null;
  experience_band: ExperienceBand | null;
  created_at: string;
  employer_viewed_at: string | null;
  job: {
    id: string;
    title_ar: string;
    title_en: string | null;
    status: JobStatus;
    expires_at: string | null;
    company: { id: string; name_ar: string; name_en: string | null } | null;
  } | null;
  candidate: { id: string; full_name: string; approval_status: ApprovalStatus } | null;
};

type Event = {
  id: number;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  created_at: string;
  actor: { full_name: string; role: UserRole } | null;
};

/**
 * One application, read-only.
 *
 * Enough to settle "what happened to my application": the listing and the
 * company, the candidate, when it was sent and opened, and every move it made
 * with who made it. Not the CV — nothing about a dispute over process needs
 * the document, and /api/cv serves it only to the two parties. The employer's
 * private notes are counted, not shown. The candidate's cover note is folded
 * away, one click from the screen, for the harassment report that needs it.
 */
export default async function AdminApplicationPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const application = must(
    await supabase
      .from('applications')
      .select(
        `id, status, note, decision_note, experience_band, created_at, employer_viewed_at,
         job:jobs (id, title_ar, title_en, status, expires_at, company:companies (id, name_ar, name_en)),
         candidate:profiles (id, full_name, approval_status)`,
      )
      .eq('id', id)
      .maybeSingle(),
    'loading an application',
  ).data as unknown as ApplicationDetail | null;
  if (!application) notFound();

  const [events, employerNotes, audit, notes] = await Promise.all([
    supabase
      .from('application_events')
      .select('id, from_status, to_status, created_at, actor:profiles (full_name, role)')
      .eq('application_id', id)
      .order('created_at'),
    supabase.from('application_notes').select('id', { count: 'exact', head: true }).eq('application_id', id),
    supabase.from('admin_audit_log').select('*').eq('target_type', 'application').eq('target_id', id).order('created_at', { ascending: false }),
    supabase.from('moderation_notes').select('*').eq('target_type', 'application').eq('target_id', id).order('created_at', { ascending: false }),
  ]);

  const history = must(events, 'loading application history').data as unknown as Event[];
  const privateNotes = must(employerNotes, 'counting employer notes').count;
  const trail = must(audit, 'loading the record').data as AdminAuditRow[];
  const noteRows = must(notes, 'loading notes').data as ModerationNoteRow[];

  const t = await getTranslations('admin');
  const tApplication = await getTranslations('applicationStatus');
  const tExperience = await getTranslations('experienceBand');
  const tOnboarding = await getTranslations('onboarding');

  const roleLabel = (role: UserRole) =>
    role === 'employer' ? tOnboarding('roleEmployer') : role === 'admin' ? t('title') : tOnboarding('roleCandidate');

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/admin/applications', label: t('applications') }}
        title={application.candidate?.full_name ?? t('applications')}
        lede={application.job ? localized(locale, application.job.title_ar, application.job.title_en) : undefined}
        actions={<Badge variant="outline">{tApplication(application.status)}</Badge>}
      />

      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t('applicationReadOnly')}</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t('application')}>
          <Facts
            items={[
              { label: t('colStatus'), value: tApplication(application.status) },
              { label: t('colSent'), value: formatDate(application.created_at, locale) },
              {
                label: t('colOpened'),
                value: application.employer_viewed_at ? formatDate(application.employer_viewed_at, locale) : t('notOpened'),
              },
              { label: t('experience'), value: application.experience_band ? tExperience(application.experience_band) : '—' },
              { label: t('decisionNote'), value: application.decision_note },
              { label: t('employerNotes'), value: <span className="numeral">{formatNumber(privateNotes, locale)}</span> },
              { label: t('accountId'), value: <code dir="ltr" className="text-xs break-all">{application.id}</code> },
            ]}
          />
          {application.note ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-primary">{t('coverNote')}</summary>
              <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">{application.note}</p>
            </details>
          ) : null}
        </Section>

        <Section title={t('parties')}>
          <div className="space-y-3 text-sm">
            {application.candidate ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/users/${application.candidate.id}`} className="font-medium hover:text-primary hover:underline">
                  {application.candidate.full_name}
                </Link>
                <ApprovalBadge status={application.candidate.approval_status} />
              </div>
            ) : null}
            {application.job ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/jobs/${application.job.id}`} className="font-medium hover:text-primary hover:underline">
                  {localized(locale, application.job.title_ar, application.job.title_en)}
                </Link>
                <JobStatusBadge status={application.job.status} expiresAt={application.job.expires_at} />
              </div>
            ) : null}
            {application.job?.company ? (
              <Link href={`/admin/companies/${application.job.company.id}`} className="block hover:text-primary hover:underline">
                {localized(locale, application.job.company.name_ar, application.job.company.name_en)}
              </Link>
            ) : null}
          </div>
        </Section>
      </div>

      <Section title={t('applicationHistory')}>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('trailEmpty')}</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 border-s-2 border-border ps-3">
                <span>
                  {event.from_status ? `${tApplication(event.from_status)} ← ` : ''}
                  <span className="font-medium">{tApplication(event.to_status)}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {event.actor ? `${event.actor.full_name} (${roleLabel(event.actor.role)})` : t('actorUnknown')} ·{' '}
                  {formatDate(event.created_at, locale)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t('record')}>
        <div className="space-y-4">
          <NoteForm targetType="application" targetId={application.id} />
          <Trail audit={trail} notes={noteRows} locale={locale} />
        </div>
      </Section>
    </div>
  );
}
