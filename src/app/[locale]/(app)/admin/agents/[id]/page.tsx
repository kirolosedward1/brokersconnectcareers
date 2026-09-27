import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ExternalLink, RotateCcw, ShieldAlert } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Avatar } from '@/components/ui/avatar';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { NoteForm } from '@/components/admin/note-form';
import { ApprovalBadge, ReportStatusBadge, VisibilityBadge } from '@/components/admin/badges';
import { Facts, PageHeader, Section, Trail } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { UUID_RE } from '@/lib/admin/params';
import { getDistrictMap } from '@/lib/queries/taxonomy';
import { formatDate, formatEgp, formatList, formatNumber } from '@/lib/utils';
import type {
  AdminAuditRow,
  AgentProfileRow,
  ApprovalStatus,
  ModerationNoteRow,
  ReportReason,
  ReportStatus,
} from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('agents'), robots: { index: false, follow: false } };
}

type AgentDetail = AgentProfileRow & {
  profile: { id: string; full_name: string; avatar_url: string | null; approval_status: ApprovalStatus };
};

type AgentReport = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  created_at: string;
  reporter: { id: string; full_name: string } | null;
};

/**
 * One consultant profile, and the one lever over it.
 *
 * Restricting hides the profile from the directory and from every employer
 * until an admin lifts it, and the consultant's own saves cannot undo it
 * (migration 206). The CV is not linked here: it is the consultant's document,
 * served by the directory's own rules, and an impersonation case is settled on
 * the profile and the reports, not the file.
 */
export default async function AdminAgentPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const agent = must(
    await supabase
      .from('agent_profiles')
      .select('*, profile:profiles (id, full_name, avatar_url, approval_status)')
      .eq('id', id)
      .maybeSingle(),
    'loading a consultant profile',
  ).data as unknown as AgentDetail | null;
  if (!agent) notFound();

  const [reports, audit, notes, districts] = await Promise.all([
    supabase
      .from('reports')
      .select('id, reason, detail, status, created_at, reporter:profiles!reports_reporter_id_fkey (id, full_name)')
      .eq('agent_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('admin_audit_log').select('*').eq('target_type', 'agent').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('moderation_notes').select('*').eq('target_type', 'agent').eq('target_id', id).order('created_at', { ascending: false }).limit(50),
    getDistrictMap(),
  ]);

  const complaints = must(reports, 'loading reports').data as unknown as AgentReport[];
  const trail = must(audit, 'loading the record').data as AdminAuditRow[];
  const noteRows = must(notes, 'loading notes').data as ModerationNoteRow[];

  const t = await getTranslations('admin');
  const tTrack = await getTranslations('track');
  const tAvailability = await getTranslations('availability');
  const tReason = await getTranslations('reportReason');
  const tCommon = await getTranslations('common');
  const restricted = Boolean(agent.restricted_at);

  const districtNames = agent.district_ids
    .map((d) => districts.get(d))
    .filter(Boolean)
    .map((d) => localized(locale, d!.name_ar, d!.name_en));

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/admin/agents', label: t('agents') }}
        title={agent.profile.full_name}
        lede={agent.headline_ar ?? undefined}
        actions={
          <>
            <VisibilityBadge visibility={agent.visibility} restricted={restricted} />
            {!restricted && agent.visibility !== 'hidden' ? (
              <Link href={`/agents/${agent.slug}`} className="inline-flex min-h-8 items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="size-3.5" aria-hidden />
                {t('publicPage')}
              </Link>
            ) : null}
          </>
        }
      />

      {restricted ? (
        <p role="status" className="rounded-xl border border-destructive/40 bg-destructive-muted px-4 py-3 text-sm text-destructive">
          {t('agentRestrictedBanner', { date: formatDate(agent.restricted_at!, locale) })}
          {agent.restriction_reason ? ` «${agent.restriction_reason}»` : null}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="space-y-5">
          <Section title={t('agentProfile')}>
            <div className="flex items-start gap-4">
              <Avatar src={agent.profile.avatar_url} name={agent.profile.full_name} size="lg" />
              <Facts
                items={[
                  { label: t('colSlug'), value: <code dir="ltr" className="text-xs">{agent.slug}</code> },
                  { label: t('colYears'), value: t('yearsN', { count: formatNumber(agent.years_experience, locale) }) },
                  { label: t('track'), value: formatList(agent.tracks.map((track) => tTrack(track)), locale) || '—' },
                  { label: t('district'), value: formatList(districtNames, locale) || '—' },
                  { label: t('languages'), value: agent.languages.join(' · ') || '—' },
                  { label: t('colAvailability'), value: tAvailability(agent.availability) },
                  {
                    label: t('unitsClosed'),
                    value: agent.units_closed != null ? <span className="numeral">{formatNumber(agent.units_closed, locale)}</span> : '—',
                  },
                  {
                    label: t('volumeClosed'),
                    value:
                      agent.volume_egp != null ? (
                        <span>
                          <span className="numeral">{formatEgp(agent.volume_egp, locale)}</span> {tCommon('egp')}
                        </span>
                      ) : (
                        '—'
                      ),
                  },
                  { label: t('hasCv'), value: agent.cv_path ? t('yes') : t('no') },
                  { label: t('colJoined'), value: formatDate(agent.created_at, locale) },
                ]}
              />
            </div>
            {agent.summary_ar ? <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{agent.summary_ar}</p> : null}
          </Section>

          <Section title={t('reportsAboutProfile')}>
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
              <NoteForm targetType="agent" targetId={agent.id} />
              <Trail audit={trail} notes={noteRows} locale={locale} />
            </div>
          </Section>
        </div>

        <aside className="order-first space-y-5 lg:order-none">
          <Section title={t('actions')}>
            {restricted ? (
              <ConfirmAction
                lever={{ do: 'restrictAgent', agentId: agent.id, restrict: false }}
                label={t('liftRestriction')}
                title={t('liftRestriction')}
                body={t('liftRestrictionBody')}
                reason="required"
                variant="success"
                icon={<RotateCcw />}
              />
            ) : (
              <ConfirmAction
                lever={{ do: 'restrictAgent', agentId: agent.id, restrict: true }}
                label={t('restrictProfile')}
                title={t('restrictProfile')}
                body={t('restrictProfileBody')}
                reason="required"
                variant="destructive"
                icon={<ShieldAlert />}
              />
            )}
          </Section>

          <Section title={t('owner')}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link href={`/admin/users/${agent.profile.id}`} className="font-medium hover:text-primary hover:underline">
                {agent.profile.full_name}
              </Link>
              <ApprovalBadge status={agent.profile.approval_status} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('contactOnAccount')}</p>
          </Section>
        </aside>
      </div>
    </div>
  );
}
