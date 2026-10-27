import { useState, type ReactNode } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatDateTime, formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { PIPELINE_STAGES } from '@/lib/application-stages';
import type { JobStatus } from '@/lib/supabase/database.types';
import { whatsappLink } from '@/lib/whatsapp';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, ApprovalBadge, Fact, SectionTitle, useRoleLabel } from '~/components/admin/kit';
import { Record } from '~/components/admin/record';
import { Avatar } from '~/components/ui/avatar';
import { ForwardChevron } from '~/components/ui/icons';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import {
  Ban,
  Check,
  CirclePause,
  Flag,
  FlagOff,
  Lock,
  LockOpen,
  LogOut,
  MessageCircle,
  Phone,
  RotateCcw,
  ShieldMinus,
  ShieldPlus,
} from '~/components/ui/lucide';
import { Segmented } from '~/components/ui/segmented';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAccountFile, type AccountFile, type AccountMembership } from '~/features/admin/accounts';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/** A UUID: anything else in the address is no account. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tab = 'overview' | 'activity' | 'security' | 'record';
const TABS: readonly Tab[] = ['overview', 'activity', 'security', 'record'];

/** The statuses, in the order the product counts them (the stages are APPLICATION_STAGES). */
const JOB_STATES: readonly JobStatus[] = ['draft', 'pending_review', 'active', 'expired', 'closed', 'rejected'];

/** What a lever's answer carries when the website reveals a contact. */
/**
 * One account's file — the website's /admin/users/<id>: who they are, what
 * they belong to, how they sign in, what they have done, and what the admins
 * decided and wrote about them, in four tabs; and the levers, each beside the
 * facts it acts on. The phone number and the email are not in the file: they
 * are revealed one account at a time, for a reason that goes on the record,
 * and held on this screen alone until it is left.
 *
 * An admin's own file has no lever but a note (the functions refuse every
 * other one), and another admin's only the two the product has for an admin
 * — removing the access, and signing them out everywhere — beside a note and
 * the contact.
 */
export default function AdminAccountScreen() {
  const t = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.account') }} />
      <AdminGate>
        {/* Keyed by the account: another account's file starts without the last one's revealed contact. */}
        <File key={typeof id === 'string' ? id : 'none'} id={typeof id === 'string' && UUID.test(id) ? id : undefined} />
      </AdminGate>
    </>
  );
}

function File({ id }: { id: string | undefined }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { actor } = useSession();
  const roleLabel = useRoleLabel();
  const file = useAccountFile(id);
  const pull = usePullRefresh(() => file.refetch());
  const [tab, setTab] = useState<Tab>('overview');

  if (!id) return <NotFoundState />;
  if (file.isPending) return <LoadingState />;
  if (file.isError && !file.data) return <ErrorState error={file.error} onRetry={() => file.refetch()} />;
  const account = file.data;
  if (!account) return <NotFoundState />;

  const { profile, facts } = account;
  const self = actor?.userId === profile.id;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[5] }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
        <Avatar name={profile.full_name} src={profile.avatar_url} seed={profile.id} size="lg" />
        <View style={{ flex: 1, gap: space[1] }}>
          <Text variant="title" weight="semibold" accessibilityRole="header">
            {profile.full_name}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {`${roleLabel(profile.role)} · ${t('admin.joinedOn', { date: formatDate(profile.created_at, locale) })}`}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
            <ApprovalBadge status={profile.approval_status} />
            {facts.sign_in_blocked_until ? <Badge variant="destructive" label={t('admin.signInBlocked')} /> : null}
          </View>
        </View>
      </View>

      <Segmented
        label={t('admin.account')}
        options={TABS.map((value) => ({ value, label: t(`admin.userTabs.${value}`) }))}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' ? (
        <Overview account={account} self={self} />
      ) : tab === 'activity' ? (
        <Activity account={account} self={self} />
      ) : tab === 'security' ? (
        <Security account={account} self={self} />
      ) : (
        <Trail account={account} self={self} />
      )}

    </ScrollView>
  );
}

/** The facts of a card, side by side where they fit. */
function Facts({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[3], columnGap: space[4] }}>{children}</View>;
}

/** A row that opens another page of the console. */
function LinkRow({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>{children}</View>
      <ForwardChevron size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

/** Who they are and what they belong to, with the account's own levers and its contact. */
function Overview({ account, self }: { account: AccountFile; self: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const roleLabel = useRoleLabel();
  const { profile, memberships, agent } = account;
  const companies = memberships.filter(
    (membership): membership is AccountMembership & { company: NonNullable<AccountMembership['company']> } => Boolean(membership.company),
  );

  return (
    <>
      <Card style={{ gap: space[4] }}>
        <SectionTitle>{t('admin.account')}</SectionTitle>
        <Facts>
          <Fact label={t('admin.colRole')}>{roleLabel(profile.role)}</Fact>
          <Fact label={t('admin.colStatus')}>
            <ApprovalBadge status={profile.approval_status} />
          </Fact>
          {profile.private?.approval_note ? <Fact label={t('admin.approvalNote')}>{profile.private.approval_note}</Fact> : null}
          <Fact label={t('admin.accountId')}>
            {/* The id as written, left to right, and copyable. */}
            <Text variant="caption" selectable style={{ writingDirection: 'ltr' }}>
              {profile.id}
            </Text>
          </Fact>
        </Facts>
      </Card>

      {companies.length ? (
        <Card style={{ gap: space[2] }}>
          <SectionTitle>{t('admin.companies')}</SectionTitle>
          {companies.map((membership) => {
            const name = localized(locale, membership.company.name_ar, membership.company.name_en);
            return (
              <LinkRow key={membership.company.id} label={name} onPress={() => router.push({ pathname: '/admin/companies/[id]', params: { id: membership.company.id } })}>
                <Text weight="medium" tone="primary">
                  {name}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
                  <Text variant="caption" tone="mutedForeground">
                    {t(`admin.memberRole.${membership.role}`)}
                  </Text>
                  <Badge
                    variant={membership.company.verification_status === 'verified' ? 'success' : 'outline'}
                    label={t(`admin.verification.${membership.company.verification_status}`)}
                  />
                  {membership.company.suspended_at ? <Badge variant="destructive" label={t('admin.suspended')} /> : null}
                </View>
              </LinkRow>
            );
          })}
        </Card>
      ) : null}

      {agent ? (
        <Card style={{ gap: space[2] }}>
          <SectionTitle>{t('admin.agentProfile')}</SectionTitle>
          <LinkRow label={agent.slug} onPress={() => router.push({ pathname: '/admin/agents/[id]', params: { id: agent.id } })}>
            <Text weight="medium" tone="primary" style={{ writingDirection: 'ltr' }}>
              {agent.slug}
            </Text>
            {agent.restricted_at ? (
              <Badge variant="destructive" label={t('admin.restricted')} />
            ) : (
              <Badge
                variant={agent.visibility === 'public' ? 'success' : agent.visibility === 'hidden' ? 'outline' : 'primary'}
                label={t(`visibility.${agent.visibility}`)}
              />
            )}
          </LinkRow>
        </Card>
      ) : null}

      <Actions account={account} self={self} />
      <Contact account={account} self={self} />
    </>
  );
}

/**
 * The account's standing and its role, as the website's aside offers them:
 * approve or restore, hold while reviewing, suspend; and making an admin —
 * or, for an admin, only unmaking one (set_account_approval refuses an
 * admin's account, and a block would be one too: demote first).
 */
function Actions({ account, self }: { account: AccountFile; self: boolean }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const roleLabel = useRoleLabel();
  const { profile, memberships } = account;
  if (self) return null;

  const admin = profile.role === 'admin';
  const employer = profile.role === 'employer';
  const approveLabel = profile.approval_status === 'rejected' ? t('admin.restoreAccount') : t('admin.approveAccount');
  const buttons: ReactNode[] = [];

  if (!admin) {
    if (profile.approval_status !== 'approved') {
      buttons.push(
        <Button
          key="approve"
          label={approveLabel}
          icon={
            profile.approval_status === 'rejected' ? (
              <RotateCcw size={18} color={colors.primaryForeground} />
            ) : (
              <Check size={18} color={colors.primaryForeground} />
            )
          }
          onPress={() =>
            openDecision({
              lever: { do: 'approval', userId: profile.id, status: 'approved' },
              title: approveLabel,
              body: t('admin.approveAccountBody'),
              confirmLabel: approveLabel,
              reason: 'none',
            })
          }
        />,
      );
    }
    // A hold while something is looked into: what is live stays, nothing new is posted or applied for.
    if (profile.approval_status === 'approved') {
      buttons.push(
        <Button
          key="restrict"
          label={t('admin.restrictAccount')}
          variant="outline"
          icon={<CirclePause size={18} color={colors.foreground} />}
          onPress={() =>
            openDecision({
              lever: { do: 'approval', userId: profile.id, status: 'pending' },
              title: t('admin.restrictAccount'),
              body: employer ? t('admin.restrictAccountBodyEmployer') : t('admin.restrictAccountBodyCandidate'),
              confirmLabel: t('admin.restrictAccount'),
              reason: 'required',
              reasonLabel: t('admin.reasonToUser'),
            })
          }
        />,
      );
    }
    if (profile.approval_status !== 'rejected') {
      buttons.push(
        <Button
          key="suspend"
          label={t('admin.suspendAccount')}
          variant="ghost"
          icon={<Ban size={18} color={colors.destructive} />}
          onPress={() =>
            openDecision({
              lever: { do: 'approval', userId: profile.id, status: 'rejected' },
              title: t('admin.suspendAccount'),
              body: employer ? t('admin.suspendTakesListingsDown') : t('admin.suspendCandidateBody'),
              confirmLabel: t('admin.suspendAccount'),
              destructive: true,
              reason: 'required',
              reasonLabel: t('admin.reasonToUser'),
            })
          }
        />,
      );
    }
    // Not while sign-in is blocked: the block is lifted only on a non-admin
    // (admin_set_sign_in_block), so this would make an admin nobody could let in.
    // Nor an account still waiting, or suspended: approve or restore it first
    // (the function refuses too), rather than have a promotion lift a hold
    // nobody meant to lift.
    if (!account.facts.sign_in_blocked_until && profile.approval_status === 'approved') buttons.push(
      <Button
        key="promote"
        label={t('admin.makeAdmin')}
        variant="ghost"
        icon={<ShieldPlus size={18} color={colors.foreground} />}
        onPress={() =>
          openDecision({
            lever: { do: 'role', userId: profile.id, role: 'admin' },
            title: t('admin.makeAdmin'),
            body: t('admin.makeAdminBody'),
            confirmLabel: t('admin.makeAdmin'),
            destructive: true,
            reason: 'required',
            reasonLabel: t('admin.reasonOnRecord'),
          })
        }
      />,
    );
  } else {
    // Back to what the account is: an employer where it belongs to a company, a candidate otherwise.
    const role = memberships.length ? 'employer' : 'candidate';
    buttons.push(
      <Button
        key="demote"
        label={t('admin.removeAdmin')}
        variant="outline"
        icon={<ShieldMinus size={18} color={colors.foreground} />}
        onPress={() =>
          openDecision({
            lever: { do: 'role', userId: profile.id, role },
            title: t('admin.removeAdmin'),
            body: t('admin.removeAdminBody', { role: roleLabel(role) }),
            confirmLabel: t('admin.removeAdmin'),
            reason: 'required',
            reasonLabel: t('admin.reasonOnRecord'),
          })
        }
      />,
    );
  }

  return (
    <Card style={{ gap: space[3] }}>
      <SectionTitle>{t('admin.actions')}</SectionTitle>
      {admin ? (
        <Text variant="small" tone="mutedForeground">
          {t('admin.adminNoLever')}
        </Text>
      ) : null}
      <View style={{ gap: space[2] }}>{buttons}</View>
    </Card>
  );
}

/**
 * Email and phone, already on the page. The database records the look.
 * Nothing is asked, and the same hour does not write the look again.
 */
function Contact({ account, self }: { account: AccountFile; self: boolean }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const contact = account.contact;
  const phone = contact?.phone?.trim() || '';

  return (
    <Card style={{ gap: space[3] }}>
      <SectionTitle>{t('admin.contact')}</SectionTitle>
      {self ? (
        <Text variant="small" tone="mutedForeground">
          {t('admin.contactSelf')}
        </Text>
      ) : null}
      <Facts>
        <Fact label={t('admin.contactEmail')}>
          <Text variant="small" selectable style={{ writingDirection: 'ltr' }}>
            {contact?.email?.trim() || '—'}
          </Text>
        </Fact>
        <Fact label={t('admin.contactPhone')}>
          <Text variant="small" selectable style={{ writingDirection: 'ltr' }}>
            {phone || '—'}
          </Text>
        </Fact>
      </Facts>
      {phone ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          <Button
            label={t('app.admin.openWhatsApp')}
            size="sm"
            icon={<MessageCircle size={16} color={colors.primaryForeground} />}
            onPress={() => Linking.openURL(whatsappLink(phone)).catch(() => {})}
          />
          <Button
            label={t('app.admin.call')}
            variant="outline"
            size="sm"
            icon={<Phone size={16} color={colors.foreground} />}
            onPress={() => Linking.openURL(`tel:${phone}`).catch(() => {})}
          />
        </View>
      ) : null}
    </Card>
  );
}

/** Counts by stage or status, the empty ones left out. */
function Counts({ entries }: { entries: { label: string; value: number }[] }) {
  const locale = useLocale();
  const shown = entries.filter((entry) => entry.value > 0);
  if (!shown.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[1], columnGap: space[3] }}>
      {shown.map((entry) => (
        <Text key={entry.label} variant="caption" tone="mutedForeground">
          {`${entry.label}: ${formatNumber(entry.value, locale)}`}
        </Text>
      ))}
    </View>
  );
}

/**
 * What the account has done, in counts (admin_user_activity, migration 355 —
 * a database before it has none, and the tab says so), the latest
 * applications, and the reports it filed: how many came to nothing is what
 * separates a careful reporter from a vexatious one, and the lever on
 * reporting is here beside it.
 */
function Activity({ account, self }: { account: AccountFile; self: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { profile, activity, applications, reportingBan } = account;
  const n = (value: number) => formatNumber(value, locale);
  const filed = activity?.reports_filed ?? null;
  const badFaith = filed?.abusive ?? 0;
  // The website's rule for weighing a reporter: any report dismissed as bad faith, or most of several found groundless.
  const pattern = filed !== null && (badFaith > 0 || (filed.total >= 3 && filed.dismissed / filed.total >= 0.5));

  return (
    <>
      {activity ? (
        <>
          <Card style={{ gap: space[3] }}>
            <SectionTitle>{t('admin.applicationsCount', { count: n(activity.applications.total) })}</SectionTitle>
            <Counts
              entries={PIPELINE_STAGES.map((status) => ({
                label: t(`applicationStatus.${status}`),
                value: activity.applications.by_status[status] ?? 0,
              }))}
            />
            {applications.length === 0 ? (
              <Text variant="small" tone="mutedForeground">
                {t('admin.noApplications')}
              </Text>
            ) : (
              applications.map((application) => (
                <View key={application.id} style={{ gap: 2, padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
                    <Text variant="small" weight="medium" style={{ flex: 1 }}>
                      {application.job ? localized(locale, application.job.title_ar, application.job.title_en) : '—'}
                    </Text>
                    <Badge variant="outline" label={t(`applicationStatus.${application.status}`)} />
                  </View>
                  <Text variant="caption" tone="mutedForeground">
                    {application.job
                      ? `${t(`jobStatus.${application.job.status}`)} · ${formatDate(application.created_at, locale)}`
                      : formatDate(application.created_at, locale)}
                  </Text>
                </View>
              ))
            )}
          </Card>

          <Card style={{ gap: space[3] }}>
            <SectionTitle>{t('admin.listingsCount', { count: n(activity.listings.total) })}</SectionTitle>
            <Counts
              entries={JOB_STATES.map((status) => ({ label: t(`jobStatus.${status}`), value: activity.listings.by_status[status] ?? 0 }))}
            />
            <View style={{ gap: space[1] }}>
              <Text variant="small">{t('admin.appealsCount', { count: n(activity.appeals.total), open: n(activity.appeals.open) })}</Text>
              <Text variant="small">{t('admin.savedJobsCount', { count: n(activity.saved_jobs) })}</Text>
              <Text variant="small">{t('admin.notesCount', { count: n(activity.notes) })}</Text>
              <Text variant="small">{t('admin.decisionsCount', { count: n(activity.decisions) })}</Text>
            </View>
          </Card>
        </>
      ) : (
        // No function to ask (a database before migration 355): said as that,
        // never as "nothing yet", which is an answer a moderator acts on.
        <Card>
          <Text variant="small" tone="mutedForeground">
            {t('admin.errors.not_migrated')}
          </Text>
        </Card>
      )}

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.reportsFiled')}</SectionTitle>
        {filed ? <Text variant="small">{t('admin.reportsFiledSummary', { count: filed.total, dismissed: n(filed.dismissed) })}</Text> : null}
        {badFaith ? (
          <Text variant="small" tone="warning">
            {t('admin.reportsBadFaith', { count: n(badFaith) })}
          </Text>
        ) : null}
        {pattern ? (
          <View style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.warningMuted }}>
            <Text variant="caption" tone="warning">
              {t('admin.reporterPattern')}
            </Text>
          </View>
        ) : null}
        {reportingBan ? (
          <View style={{ gap: 2 }}>
            <Text variant="small">{t('admin.reportingBanned', { date: formatDate(reportingBan.created_at, locale) })}</Text>
            <Text variant="small" tone="mutedForeground">{`«${reportingBan.reason}»`}</Text>
          </View>
        ) : null}
        {profile.role !== 'admin' && !self ? (
          <View style={{ flexDirection: 'row' }}>
            <Button
              label={reportingBan ? t('admin.reportingUnban') : t('admin.reportingBan')}
              variant={reportingBan ? 'outline' : 'ghost'}
              size="sm"
              icon={
                reportingBan ? <FlagOff size={16} color={colors.foreground} /> : <Flag size={16} color={colors.foreground} />
              }
              onPress={() =>
                openDecision({
                  lever: { do: 'reporting', userId: profile.id, restrict: !reportingBan },
                  title: reportingBan ? t('admin.reportingUnban') : t('admin.reportingBan'),
                  body: reportingBan ? t('admin.reportingUnbanBody') : t('admin.reportingBanBody'),
                  confirmLabel: reportingBan ? t('admin.reportingUnban') : t('admin.reportingBan'),
                  reason: 'required',
                  reasonLabel: t('admin.reportingBanReason'),
                })
              }
            />
          </View>
        ) : null}
      </Card>
    </>
  );
}

/**
 * How and where the account signs in (admin_user_facts), and the door's
 * levers: blocking sign-in — the auth server's own ban, which also signs
 * every device out — and signing them out everywhere. An admin's sign-in is
 * not blocked from here: the access is removed first (the function says so).
 */
function Security({ account, self }: { account: AccountFile; self: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { profile, facts } = account;
  const blocked = Boolean(facts.sign_in_blocked_until);
  const admin = profile.role === 'admin';
  // Since when: the record's latest block. The ban itself holds only an
  // "until", a century away, which is no date to show anybody.
  const blockedSince = blocked ? (account.audit.find((row) => row.action === 'user.sign_in_blocked')?.created_at ?? null) : null;

  return (
    <>
      <Card style={{ gap: space[4] }}>
        <SectionTitle>{t('admin.userTabs.security')}</SectionTitle>
        <Facts>
          <Fact label={t('admin.emailConfirmed')}>{facts.email_confirmed ? t('admin.yes') : t('admin.no')}</Fact>
          <Fact label={t('admin.signInWith')}>{formatList(facts.providers ?? [], locale) || '—'}</Fact>
          <Fact label={t('admin.lastSignIn')}>{facts.last_sign_in_at ? formatDateTime(facts.last_sign_in_at, locale) : '—'}</Fact>
          <Fact label={t('admin.twoStep')}>{(facts.verified_factors ?? 0) > 0 ? t('admin.yes') : t('admin.no')}</Fact>
          <Fact label={t('admin.signedInDevices')}>{facts.sessions == null ? '—' : formatNumber(facts.sessions, locale)}</Fact>
        </Facts>
        {blocked ? (
          <Text variant="small" weight="medium" tone="destructive">
            {blockedSince ? t('admin.signInBlockedSince', { date: formatDate(blockedSince, locale) }) : t('admin.signInBlocked')}
          </Text>
        ) : (
          <Text variant="small" tone="mutedForeground">
            {t('admin.signInAllowed')}
          </Text>
        )}
      </Card>

      {self ? null : (
        <Card style={{ gap: space[3] }}>
          <SectionTitle>{t('admin.actions')}</SectionTitle>
          <View style={{ gap: space[2] }}>
            {/* Neither direction for an admin: the function refuses both (demote first). */}
            {admin ? null : blocked ? (
              <Button
                label={t('admin.unblockSignIn')}
                variant="outline"
                icon={<LockOpen size={18} color={colors.foreground} />}
                onPress={() =>
                  openDecision({
                    lever: { do: 'signInBlock', userId: profile.id, block: false },
                    title: t('admin.unblockSignIn'),
                    body: t('admin.unblockSignInBody'),
                    confirmLabel: t('admin.unblockSignIn'),
                    reason: 'required',
                    reasonLabel: t('admin.reasonOnRecord'),
                  })
                }
              />
            ) : (
              <Button
                label={t('admin.blockSignIn')}
                variant="ghost"
                icon={<Lock size={18} color={colors.destructive} />}
                onPress={() =>
                  openDecision({
                    lever: { do: 'signInBlock', userId: profile.id, block: true },
                    title: t('admin.blockSignIn'),
                    body: t('admin.blockSignInBody'),
                    confirmLabel: t('admin.blockSignIn'),
                    destructive: true,
                    reason: 'required',
                    reasonLabel: t('admin.reasonOnRecord'),
                  })
                }
              />
            )}
            <Button
              label={t('admin.endSessions')}
              variant="outline"
              icon={<LogOut size={18} color={colors.foreground} />}
              onPress={() =>
                openDecision({
                  lever: { do: 'sessions', userId: profile.id },
                  title: t('admin.endSessions'),
                  body: t('admin.endSessionsBody'),
                  confirmLabel: t('admin.endSessions'),
                  reason: 'required',
                  reasonLabel: t('admin.reasonOnRecord'),
                })
              }
            />
          </View>
        </Card>
      )}
    </>
  );
}

/** The decisions and the notes on the account, newest first, as the website's Trail has them; and a note to add. */
/** The record, as every file draws it (components/admin/record.tsx), from the rows the file already read. */
function Trail({ account }: { account: AccountFile; self: boolean }) {
  // On every file, one's own included: a note is for other admins, and admin_add_note refuses nobody.
  return <Record targetType="user" targetId={account.profile.id} audit={account.audit} notes={account.notes} />;
}
