import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ban, Check, CirclePause, Flag, Lock, LockOpen, LogOut, RotateCcw, ShieldOff, ShieldPlus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { RevealContact } from '@/components/admin/reveal-contact';
import { NoteForm } from '@/components/admin/note-form';
import { ApprovalBadge, VerificationBadge, VisibilityBadge } from '@/components/admin/badges';
import { Facts, FilterTabs, PageHeader, Section, Trail } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { UUID_RE, oneOf, param, type SearchParams } from '@/lib/admin/params';
import { formatDate, formatList, formatNumber } from '@/lib/utils';
import { PIPELINE_STAGES } from '@/lib/application-stages';
import type {
  AdminAuditRow,
  AdminUserActivity,
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

/**
 * The page in four tabs, each a URL: what the account is, what it has done,
 * how it signs in, and what the admins decided and wrote. A tab is a server
 * render of its own reads — the record's fifty rows are not fetched to show
 * the overview — and the levers in the aside stay in reach on every one.
 */
const TABS = ['overview', 'activity', 'security', 'record'] as const;
type Tab = (typeof TABS)[number];

type Db = Awaited<ReturnType<typeof createClient>>;

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

/** The states in the order the product moves through them, so a breakdown reads as a pipeline (as APPLICATION_STAGES does). */
const LISTING_STATES: readonly JobStatus[] = ['draft', 'pending_review', 'active', 'expired', 'closed', 'rejected'];

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
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const viewer = await requireAdmin(locale);
  if (!UUID_RE.test(id)) notFound();
  const tab = oneOf(param(await searchParams, 'tab'), TABS, 'overview');

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

  // What every tab needs: the memberships (the overview lists them, the
  // activity tab links through them, and the role lever asks them what an
  // admin goes back to), and the aside's reporting record.
  const [memberships, reportsFiled, reportingBan] = await Promise.all([
    supabase
      .from('company_members')
      .select('role, created_at, company:companies (id, name_ar, name_en, verification_status, suspended_at)')
      .eq('user_id', id),
    supabase.from('reports').select('status, abusive').eq('reporter_id', id),
    // A ban on reporting is its own admin-only record (migration 326).
    supabase.from('reporting_restrictions').select('reason, created_at').eq('user_id', id).maybeSingle(),
  ]);

  const companies = must(memberships, 'loading memberships').data as unknown as Membership[];
  const filed = must(reportsFiled, 'loading reports filed').data as { status: string; abusive?: boolean }[];
  const badFaith = filed.filter((row) => row.abusive).length;
  const ban = reportingBan.data as { reason: string; created_at: string } | null;

  const t = await getTranslations('admin');
  const tOnboarding = await getTranslations('onboarding');
  const n = (value: number) => formatNumber(value, locale);

  const roleLabel =
    profile.role === 'employer' ? tOnboarding('roleEmployer') : profile.role === 'admin' ? t('title') : tOnboarding('roleCandidate');
  const self = viewer.userId === profile.id;
  const dismissed = filed.filter((row) => row.status === 'dismissed').length;
  const tabHref = (value: Tab) => (value === 'overview' ? `/admin/users/${profile.id}` : `/admin/users/${profile.id}?tab=${value}`);

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
          <FilterTabs
            label={t('account')}
            items={TABS.map((value) => ({
              key: value,
              label: t(`userTabs.${value}`),
              href: tabHref(value),
              active: tab === value,
            }))}
          />

          {tab === 'overview' ? (
            <OverviewTab supabase={supabase} profile={profile} companies={companies} locale={locale} roleLabel={roleLabel} />
          ) : tab === 'activity' ? (
            <ActivityTab supabase={supabase} profile={profile} companies={companies} locale={locale} recordHref={tabHref('record')} />
          ) : tab === 'security' ? (
            <SecurityTab supabase={supabase} profile={profile} companies={companies} locale={locale} self={self} roleLabel={roleLabel} />
          ) : (
            <RecordTab supabase={supabase} profile={profile} locale={locale} />
          )}
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
                    icon={profile.approval_status === 'rejected' ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
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
                    icon={<CirclePause aria-hidden />}
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
                    icon={<Ban aria-hidden />}
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
              {t('reportsFiledSummary', { count: filed.length, dismissed: n(dismissed) })}
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
                  icon={<Flag aria-hidden />}
                />
              </div>
            ) : null}
          </Section>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview: what the account is and what it belongs to
// ---------------------------------------------------------------------------

async function OverviewTab({
  supabase,
  profile,
  companies,
  locale,
  roleLabel,
}: {
  supabase: Db;
  profile: Profile;
  companies: Membership[];
  locale: Locale;
  roleLabel: string;
}) {
  const agent = await supabase.from('agent_profiles').select('id, slug, visibility, restricted_at').eq('user_id', profile.id).maybeSingle();
  const agentProfile = must(agent, 'loading the consultant profile').data as {
    id: string;
    slug: string;
    visibility: AgentVisibility;
    restricted_at?: string | null;
  } | null;

  const t = await getTranslations('admin');

  return (
    <>
      <Section title={t('account')}>
        <div className="flex items-start gap-4">
          <Avatar src={profile.avatar_url} name={profile.full_name} size="lg" />
          <Facts
            items={[
              { label: t('colRole'), value: roleLabel },
              { label: t('colStatus'), value: <ApprovalBadge status={profile.approval_status} /> },
              { label: t('approvalNote'), value: profile.private?.approval_note ?? null },
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Activity: what the account has done, in counts
// ---------------------------------------------------------------------------

/** A label and its figure, side by side, for a breakdown that fits on one line. */
function Breakdown({ items }: { items: { key: string; label: string; count: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.key}>
          {item.label} <span className="numeral font-medium text-foreground">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

async function ActivityTab({
  supabase,
  profile,
  companies,
  locale,
  recordHref,
}: {
  supabase: Db;
  profile: Profile;
  companies: Membership[];
  locale: Locale;
  recordHref: string;
}) {
  const activity = must(await supabase.rpc('admin_user_activity', { p_user: profile.id }), 'loading activity').data as AdminUserActivity;

  const t = await getTranslations('admin');
  const tApplication = await getTranslations('applicationStatus');
  const tJob = await getTranslations('jobStatus');
  const n = (value: number) => formatNumber(value, locale);

  const nothing =
    activity.applications.total === 0 &&
    activity.listings.total === 0 &&
    activity.reports_filed.total === 0 &&
    activity.appeals.total === 0 &&
    activity.saved_jobs === 0 &&
    activity.notes === 0 &&
    activity.decisions === 0;
  if (nothing) {
    return (
      <Section title={t('userTabs.activity')}>
        <p className="text-sm text-muted-foreground">{t('activityEmpty')}</p>
      </Section>
    );
  }

  // The applications themselves, for a candidate: the ten most recent, with
  // the stage counts the database already summed above them.
  const applications =
    profile.role === 'candidate'
      ? must(
          await supabase
            .from('applications')
            .select('id, status, created_at, job:jobs (id, title_ar, title_en, status)', { count: 'exact' })
            .eq('candidate_id', profile.id)
            .order('created_at', { ascending: false })
            .limit(10),
          'loading applications',
        )
      : null;
  const recent = (applications?.data ?? []) as unknown as RecentApplication[];

  // The listings are every member company's. One company is a link to its
  // listings; more than one has no single list to point at, and the companies
  // are each a link on the overview.
  const onlyCompany = companies.length === 1 ? companies[0].company : null;

  return (
    <>
      {applications ? (
        <Section
          title={t('applicationsCount', { count: n(applications.count) })}
          actions={
            applications.count > recent.length ? (
              <Link href={`/admin/applications?candidate=${profile.id}`} className="text-xs text-primary hover:underline">
                {t('seeAll')}
              </Link>
            ) : null
          }
        >
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noApplications')}</p>
          ) : (
            <div className="space-y-3">
              <Breakdown
                items={PIPELINE_STAGES.filter((stage) => activity.applications.by_status[stage]).map((stage) => ({
                  key: stage,
                  label: tApplication(stage),
                  count: n(activity.applications.by_status[stage] ?? 0),
                }))}
              />
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
            </div>
          )}
        </Section>
      ) : null}

      {companies.length ? (
        <Section
          title={t('listingsCount', { count: n(activity.listings.total) })}
          actions={
            onlyCompany ? (
              <Link href={`/admin/jobs?status=all&company=${onlyCompany.id}`} className="text-xs text-primary hover:underline">
                {t('seeAll')}
              </Link>
            ) : null
          }
        >
          {activity.listings.total === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noListings')}</p>
          ) : (
            <Breakdown
              items={LISTING_STATES.filter((state) => activity.listings.by_status[state]).map((state) => ({
                key: state,
                label: tJob(state),
                count: n(activity.listings.by_status[state] ?? 0),
              }))}
            />
          )}
        </Section>
      ) : null}

      <Section title={t('userTabs.activity')}>
        <ul className="space-y-1.5 text-sm">
          <li>{t('appealsCount', { count: n(activity.appeals.total), open: n(activity.appeals.open) })}</li>
          <li>{t('savedJobsCount', { count: n(activity.saved_jobs) })}</li>
          <li>
            {activity.notes ? (
              <Link href={recordHref} className="hover:text-primary hover:underline">
                {t('notesCount', { count: n(activity.notes) })}
              </Link>
            ) : (
              t('notesCount', { count: n(activity.notes) })
            )}
          </li>
          <li>
            {activity.decisions ? (
              <Link href={recordHref} className="hover:text-primary hover:underline">
                {t('decisionsCount', { count: n(activity.decisions) })}
              </Link>
            ) : (
              t('decisionsCount', { count: n(activity.decisions) })
            )}
          </li>
        </ul>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Security: how the account signs in, and the door
// ---------------------------------------------------------------------------

async function SecurityTab({
  supabase,
  profile,
  companies,
  locale,
  self,
  roleLabel,
}: {
  supabase: Db;
  profile: Profile;
  companies: Membership[];
  locale: Locale;
  self: boolean;
  roleLabel: string;
}) {
  const facts = must(await supabase.rpc('admin_user_facts', { p_user: profile.id }), 'loading sign-in facts').data as AdminUserFacts;
  const blocked = Boolean(facts.sign_in_blocked_until);

  // Since when: the auth server keeps only "until", which the lever sets to
  // the end of the millennium, so the date an admin wants is the lever's own
  // record. A block set some other way has no record, and is shown without a
  // date rather than with a wrong one.
  const blockedSince = blocked
    ? (
        must(
          await supabase
            .from('admin_audit_log')
            .select('created_at')
            .eq('target_type', 'user')
            .eq('target_id', profile.id)
            .eq('action', 'user.sign_in_blocked')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          'loading the record',
        ).data as { created_at: string } | null
      )?.created_at ?? null
    : null;

  const t = await getTranslations('admin');
  const tOnboarding = await getTranslations('onboarding');
  const n = (value: number) => formatNumber(value, locale);

  // What an admin goes back to: an account with a company is an employer's,
  // one without is a candidate's. The function will not make an employer of
  // a candidate, so this is the only choice there is.
  const returnsTo = companies.length ? 'employer' : 'candidate';
  const returnsToLabel = returnsTo === 'employer' ? tOnboarding('roleEmployer') : tOnboarding('roleCandidate');

  return (
    <>
      <Section title={t('userTabs.security')}>
        <div className="space-y-4">
          {blocked ? (
            <p className="rounded-lg bg-destructive-muted px-3 py-2 text-sm text-destructive">
              {blockedSince ? t('signInBlockedSince', { date: formatDate(blockedSince, locale) }) : t('signInBlocked')}
            </p>
          ) : 'sign_in_blocked_until' in facts ? (
            <p className="text-sm text-muted-foreground">{t('signInAllowed')}</p>
          ) : (
            // A database before migration 355 does not say: unknown, not "allowed".
            <p className="text-sm text-muted-foreground">—</p>
          )}

          <Facts
            items={[
              { label: t('emailConfirmed'), value: facts.email_confirmed ? t('yes') : t('no') },
              { label: t('signInWith'), value: formatList(facts.providers ?? [], locale) || '—' },
              { label: t('lastSignIn'), value: facts.last_sign_in_at ? formatDate(facts.last_sign_in_at, locale) : '—' },
              // Unknown on a database before migration 355: said as unknown, not as "no".
              { label: t('twoStep'), value: typeof facts.verified_factors === 'number' ? (facts.verified_factors > 0 ? t('yes') : t('no')) : '—' },
              { label: t('signedInDevices'), value: typeof facts.sessions === 'number' ? n(facts.sessions) : '—' },
            ]}
          />

          {self ? (
            <p className="text-sm text-muted-foreground">{t('contactSelf')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* An admin's door is not shut from here (the function refuses):
                  take the admin role away first, below. */}
              {profile.role !== 'admin' ? (
                blocked ? (
                  <ConfirmAction
                    lever={{ do: 'signInBlock', userId: profile.id, block: false }}
                    label={t('unblockSignIn')}
                    title={t('unblockSignIn')}
                    body={t('unblockSignInBody')}
                    reason="required"
                    reasonLabel={t('reasonOnRecord')}
                    variant="outline"
                    icon={<LockOpen aria-hidden />}
                  />
                ) : (
                  <ConfirmAction
                    lever={{ do: 'signInBlock', userId: profile.id, block: true }}
                    label={t('blockSignIn')}
                    title={t('blockSignIn')}
                    body={t('blockSignInBody')}
                    reason="required"
                    reasonLabel={t('reasonOnRecord')}
                    variant="destructive"
                    icon={<Lock aria-hidden />}
                  />
                )
              ) : null}
              <ConfirmAction
                lever={{ do: 'sessions', userId: profile.id }}
                label={t('endSessions')}
                title={t('endSessions')}
                body={t('endSessionsBody')}
                reason="required"
                reasonLabel={t('reasonOnRecord')}
                variant="outline"
                icon={<LogOut aria-hidden />}
              />
            </div>
          )}
        </div>
      </Section>

      {/* Never for self: the function refuses, and the one admin left is
          always the one who cannot act on themselves. */}
      {self ? null : (
        <Section title={t('colRole')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">{roleLabel}</span>
            {profile.role === 'admin' ? (
              <ConfirmAction
                lever={{ do: 'role', userId: profile.id, role: returnsTo }}
                label={t('removeAdmin')}
                title={t('removeAdmin')}
                body={t('removeAdminBody', { role: returnsToLabel })}
                reason="required"
                reasonLabel={t('reasonOnRecord')}
                variant="outline"
                icon={<ShieldOff aria-hidden />}
              />
            ) : blocked ? (
              // Not while sign-in is blocked: the block is lifted only on a
              // non-admin, so this would make an admin nobody could let in.
              <span className="text-sm text-muted-foreground">{t('signInBlocked')}</span>
            ) : profile.approval_status !== 'approved' ? (
              // Nor while waiting or suspended: approve or restore it first,
              // on the record (the function refuses too).
              <span className="text-sm text-muted-foreground">{t('approveFirst')}</span>
            ) : (
              <ConfirmAction
                lever={{ do: 'role', userId: profile.id, role: 'admin' }}
                label={t('makeAdmin')}
                title={t('makeAdmin')}
                body={t('makeAdminBody')}
                reason="required"
                reasonLabel={t('reasonOnRecord')}
                variant="destructive"
                icon={<ShieldPlus aria-hidden />}
              />
            )}
          </div>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Record: what the admins decided and wrote
// ---------------------------------------------------------------------------

async function RecordTab({ supabase, profile, locale }: { supabase: Db; profile: Profile; locale: Locale }) {
  const [audit, notes] = await Promise.all([
    supabase
      .from('admin_audit_log')
      .select('*')
      .eq('target_type', 'user')
      .eq('target_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('moderation_notes')
      .select('*')
      .eq('target_type', 'user')
      .eq('target_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const trail = must(audit, 'loading the record').data as AdminAuditRow[];
  const noteRows = must(notes, 'loading notes').data as ModerationNoteRow[];

  const t = await getTranslations('admin');

  return (
    <Section title={t('record')}>
      <div className="space-y-4">
        <NoteForm targetType="user" targetId={profile.id} />
        <Trail audit={trail} notes={noteRows} locale={locale} />
      </div>
    </Section>
  );
}
