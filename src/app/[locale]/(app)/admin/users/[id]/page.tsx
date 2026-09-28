import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, CirclePause, Flag, RotateCcw, Ban } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { RevealContact } from '@/components/admin/reveal-contact';
import { NoteForm } from '@/components/admin/note-form';
import { ApprovalBadge, VerificationBadge, VisibilityBadge } from '@/components/admin/badges';
import { Facts, PageHeader, Section, Trail } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { UUID_RE } from '@/lib/admin/params';
import { formatDate, formatList, formatNumber } from '@/lib/utils';
import type {
  AdminAuditRow,
  AdminUserFacts,
  AgentVisibility,
  ApplicationStatus,
  ApprovalStatus,
  CompanyMemberRole,
  JobStatus,
  ModerationNoteRow,
  UserRole,
  VerificationStatus,
} from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('users'), robots: { index: false, follow: false } };
}

type Profile = {
  id: string;
  role: UserRole;
  full_name: string;
  avatar_url: string | null;
  locale: 'ar' | 'en';
  created_at: string;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  /** The reviewer's note lives on profile_private (migration 305), readable by admins alone. */
  private: { approval_note: string | null } | null;
};

type Membership = {
  role: CompanyMemberRole;
  created_at: string;
  company: {
    id: string;
    name_ar: string;
    name_en: string | null;
    verification_status: VerificationStatus;
    suspended_at?: string | null;
  } | null;
};

type RecentApplication = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  job: { id: string; title_ar: string; title_en: string | null; status: JobStatus } | null;
};

/**
 * One account, as an operator needs to see it.
 *
 * Who they are, what they belong to, what they have done on the platform, and
 * what the admins have decided and written about them — without their phone
 * number or email, which are one deliberate, recorded click away. The profile
 * is read by naming its columns rather than `*`, so the number is not even in
 * the server's memory for this page.
 */
export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const viewer = await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const profileRead = await supabase
    .from('profiles')
    .select('id, role, full_name, avatar_url, locale, created_at, approval_status, approved_at, private:profile_private (approval_note)')
    .eq('id', id)
    .maybeSingle();
  // The generated types do not know profile_private's foreign key yet, so the
  // embed is typed by hand, as the accounts list does.
  const profile = must(profileRead, 'loading an account').data as unknown as Profile | null;
  if (!profile) notFound();

  const [facts, memberships, agent, applications, reportsFiled, audit, notes, reportingBan] = await Promise.all([
    supabase.rpc('admin_user_facts', { p_user: id }),
    supabase
      .from('company_members')
      .select('role, created_at, company:companies (id, name_ar, name_en, verification_status, suspended_at)')
      .eq('user_id', id),
    supabase.from('agent_profiles').select('id, slug, visibility, restricted_at').eq('user_id', id).maybeSingle(),
    supabase
      .from('applications')
      .select('id, status, created_at, job:jobs (id, title_ar, title_en, status)', { count: 'exact' })
      .eq('candidate_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('reports').select('status, abusive').eq('reporter_id', id),
    supabase
      .from('admin_audit_log')
      .select('*')
      .eq('target_type', 'user')
      .eq('target_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('moderation_notes')
      .select('*')
      .eq('target_type', 'user')
      .eq('target_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    // A ban on reporting is its own admin-only record (migration 326).
    supabase.from('reporting_restrictions').select('reason, created_at').eq('user_id', id).maybeSingle(),
  ]);

  const auth = must(facts, 'loading sign-in facts').data as AdminUserFacts;
  const companies = must(memberships, 'loading memberships').data as unknown as Membership[];
  const agentProfile = must(agent, 'loading the consultant profile').data as {
    id: string;
    slug: string;
    visibility: AgentVisibility;
    restricted_at?: string | null;
  } | null;
  const apps = must(applications, 'loading applications');
  const recent = apps.data as unknown as RecentApplication[];
  const filed = must(reportsFiled, 'loading reports filed').data as { status: string; abusive?: boolean }[];
  const badFaith = filed.filter((row) => row.abusive).length;
  const ban = reportingBan.data as { reason: string; created_at: string } | null;
  const trail = must(audit, 'loading the record').data as AdminAuditRow[];
  const noteRows = must(notes, 'loading notes').data as ModerationNoteRow[];

  const t = await getTranslations('admin');
  const tOnboarding = await getTranslations('onboarding');
  const tApplication = await getTranslations('applicationStatus');
  const tJob = await getTranslations('jobStatus');
  const n = (value: number) => formatNumber(value, locale);

  const roleLabel =
    profile.role === 'employer' ? tOnboarding('roleEmployer') : profile.role === 'admin' ? t('title') : tOnboarding('roleCandidate');
  const self = viewer.userId === profile.id;
  const dismissed = filed.filter((row) => row.status === 'dismissed').length;

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/admin/users', label: t('users') }}
        title={profile.full_name}
        lede={`${roleLabel} · ${t('joinedOn', { date: formatDate(profile.created_at, locale) })}`}
        actions={<ApprovalBadge status={profile.approval_status} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="space-y-5">
          <Section title={t('account')}>
            <div className="flex items-start gap-4">
              <Avatar src={profile.avatar_url} name={profile.full_name} size="lg" />
              <Facts
                items={[
                  { label: t('colRole'), value: roleLabel },
                  { label: t('colStatus'), value: <ApprovalBadge status={profile.approval_status} /> },
                  { label: t('approvalNote'), value: profile.private?.approval_note ?? null },
                  { label: t('emailConfirmed'), value: auth.email_confirmed ? t('yes') : t('no') },
                  {
                    label: t('lastSignIn'),
                    value: auth.last_sign_in_at ? formatDate(auth.last_sign_in_at, locale) : '—',
                  },
                  { label: t('signInWith'), value: formatList(auth.providers ?? [], locale) || '—' },
                  { label: t('accountId'), value: <code dir="ltr" className="text-xs break-all">{profile.id}</code> },
                ]}
              />
            </div>
          </Section>

          {companies.length ? (
            <Section title={t('companies')}>
              <ul className="divide-y divide-border">
                {companies.map((membership) =>
                  membership.company ? (
                    <li key={membership.company.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/admin/companies/${membership.company.id}`} className="font-medium hover:text-primary hover:underline">
                        {localized(locale, membership.company.name_ar, membership.company.name_en)}
                      </Link>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {t(`memberRole.${membership.role}`)}
                        <VerificationBadge
                          status={membership.company.verification_status}
                          suspended={Boolean(membership.company.suspended_at)}
                        />
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            </Section>
          ) : null}

          {agentProfile ? (
            <Section title={t('agentProfile')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/agents/${agentProfile.id}`} className="font-medium hover:text-primary hover:underline">
                  {agentProfile.slug}
                </Link>
                <VisibilityBadge visibility={agentProfile.visibility} restricted={Boolean(agentProfile.restricted_at)} />
              </div>
            </Section>
          ) : null}

          {profile.role === 'candidate' ? (
            <Section
              title={t('applicationsCount', { count: n(apps.count) })}
              actions={
                apps.count > recent.length ? (
                  <Link href={`/admin/applications?candidate=${profile.id}`} className="text-xs text-primary hover:underline">
                    {t('seeAll')}
                  </Link>
                ) : null
              }
            >
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noApplications')}</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {recent.map((application) => (
                    <li key={application.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/admin/applications/${application.id}`} className="min-w-0 truncate hover:text-primary hover:underline">
                        {application.job ? localized(locale, application.job.title_ar, application.job.title_en) : '—'}
                      </Link>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {application.job ? tJob(application.job.status) : null}
                        <Badge variant="outline">{tApplication(application.status)}</Badge>
                        {formatDate(application.created_at, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          <Section title={t('record')}>
            <div className="space-y-4">
              <NoteForm targetType="user" targetId={profile.id} />
              <Trail audit={trail} notes={noteRows} locale={locale} />
            </div>
          </Section>
        </div>

        <aside className="order-first space-y-5 lg:order-none">
          <Section title={t('actions')}>
            {profile.role === 'admin' ? (
              <p className="text-sm text-muted-foreground">{t('adminNoLever')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {profile.approval_status !== 'approved' ? (
                  <ConfirmAction
                    lever={{ do: 'approval', userId: profile.id, status: 'approved' }}
                    label={profile.approval_status === 'rejected' ? t('restoreAccount') : t('approveAccount')}
                    title={profile.approval_status === 'rejected' ? t('restoreAccount') : t('approveAccount')}
                    body={t('approveAccountBody')}
                    variant="success"
                    icon={profile.approval_status === 'rejected' ? <RotateCcw /> : <Check />}
                  />
                ) : null}
                {/* Restrict: a hold while something is looked into. Live
                    listings and applications stay; nothing new is posted,
                    submitted or applied for. The person is told, and can
                    ask for a review. */}
                {profile.approval_status === 'approved' ? (
                  <ConfirmAction
                    lever={{ do: 'approval', userId: profile.id, status: 'pending' }}
                    label={t('restrictAccount')}
                    title={t('restrictAccount')}
                    body={profile.role === 'employer' ? t('restrictAccountBodyEmployer') : t('restrictAccountBodyCandidate')}
                    reason="required"
                    reasonLabel={t('reasonToUser')}
                    variant="outline"
                    icon={<CirclePause />}
                  />
                ) : null}
                {profile.approval_status !== 'rejected' ? (
                  <ConfirmAction
                    lever={{ do: 'approval', userId: profile.id, status: 'rejected' }}
                    label={t('suspendAccount')}
                    title={t('suspendAccount')}
                    body={profile.role === 'employer' ? t('suspendTakesListingsDown') : t('suspendCandidateBody')}
                    reason="required"
                    reasonLabel={t('reasonToUser')}
                    variant="destructive"
                    icon={<Ban />}
                  />
                ) : null}
              </div>
            )}
          </Section>

          <Section title={t('contact')}>
            {self ? <p className="text-sm text-muted-foreground">{t('contactSelf')}</p> : <RevealContact userId={profile.id} />}
          </Section>

          <Section title={t('reportsFiled')}>
            <p className="text-sm">
              {t('reportsFiledSummary', { count: n(filed.length), dismissed: n(dismissed) })}
            </p>
            {badFaith ? <p className="mt-1 text-sm text-warning">{t('reportsBadFaith', { count: n(badFaith) })}</p> : null}
            {badFaith || (filed.length >= 3 && dismissed / filed.length >= 0.5) ? (
              <p className="mt-2 rounded-lg bg-warning-muted px-3 py-2 text-xs text-warning">{t('reporterPattern')}</p>
            ) : null}
            {ban ? (
              <p className="mt-2 text-sm">
                {t('reportingBanned', { date: formatDate(ban.created_at, locale) })}
                <span className="block text-muted-foreground">«{ban.reason}»</span>
              </p>
            ) : null}
            {profile.role !== 'admin' && !self ? (
              <div className="mt-3">
                <ConfirmAction
                  lever={{ do: 'reporting', userId: profile.id, restrict: !ban }}
                  label={ban ? t('reportingUnban') : t('reportingBan')}
                  title={ban ? t('reportingUnban') : t('reportingBan')}
                  body={ban ? t('reportingUnbanBody') : t('reportingBanBody')}
                  reason="required"
                  reasonLabel={t('reportingBanReason')}
                  variant={ban ? 'outline' : 'ghost'}
                  icon={<Flag />}
                />
              </div>
            ) : null}
          </Section>
        </aside>
      </div>
    </div>
  );
}
