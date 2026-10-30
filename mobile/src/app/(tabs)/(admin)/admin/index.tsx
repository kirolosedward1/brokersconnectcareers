import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import type { AdminOverview } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, auditLabel, SectionTitle } from '~/components/admin/kit';
import { MailOffBanner } from '~/components/admin/mail-banner';
import { StandingNotice } from '~/components/dashboard/standing-notice';
import { StatStrip, type StatCell } from '~/components/dashboard/stat-strip';
import { StackedBars } from '~/components/dashboard/stacked-bars';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { Button } from '~/components/ui/button';
import { ForwardChevron } from '~/components/ui/icons';
import { CheckCheck } from '~/components/ui/lucide';
import { SearchField } from '~/components/ui/search-field';
import { ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAdminOverview, useAdminSummary, useAdminTrend, useDeletionRequests, type DeletionRequest } from '~/features/admin/queries';
import { useTabList } from '~/features/tab-bar';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/**
 * The Admin tab — the website's /admin, where an operator starts the day.
 *
 * Three rows, in the order they are acted on: what is waiting on a person,
 * the health of the marketplace, and the two populations it serves. Every
 * figure is a count the database made just now (admin_overview, one round
 * trip), and every one opens the filtered list behind it — a number you
 * cannot open is a number you cannot act on. Between the first row and the
 * second, the owners asking to leave, while there are any; under them, thirty
 * days of activity, and the decisions made lately, by whom; last, every part
 * of the console, as the website's rail lists them.
 */
export default function AdminOverviewScreen() {
  const t = useTranslations();
  const bell = useHeaderBell();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.title'), headerRight: bell }} />
      <AdminGate>
        <Overview />
      </AdminGate>
    </>
  );
}

/** Where a decision's subject is looked at: the console's own screen for each kind of target, by the website's path. */
function targetPath(entry: AdminOverview['recent'][number]): string | null {
  const paths: Record<string, string> = {
    job: '/admin/jobs',
    company: '/admin/companies',
    user: '/admin/users',
    agent: '/admin/agents',
    application: '/admin/applications',
  };
  const base = paths[entry.target_type];
  return base && entry.target_id ? `${base}/${entry.target_id}` : null;
}

/**
 * A press that opens one of the console's screens by the website's own path
 * and query, as its list screens read them (?status=, ?role=, ?visibility=,
 * ?q=): every figure, row and name on this screen goes through here.
 */
function go(pathname: string, params?: Record<string, string>) {
  return () => router.navigate(params ? { pathname, params } : pathname);
}

function Overview() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { viewer } = useSession();
  const overview = useAdminOverview();
  const trend = useAdminTrend();
  const deletions = useDeletionRequests();
  // The section list's badges are the tab's (admin_summary), read again with the rest.
  const summary = useAdminSummary();
  const pull = usePullRefresh(() => Promise.all([overview.refetch(), trend.refetch(), deletions.refetch(), summary.refetch()]));
  const list = useTabList();
  const [query, setQuery] = useState('');
  const n = (value: number) => formatNumber(value, locale);

  if (overview.isPending) return <LoadingState />;
  if (overview.isError && !overview.data) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  const o = overview.data;
  const appsDelta = o.applications.last_7d - o.applications.prev_7d;

  const attention: StatCell[] = [
    { label: t('dashboard.statQueue'), value: n(o.jobs.pending), tone: o.jobs.pending > 0 ? 'accent' : 'default', onPress: go('/admin/jobs', { status: 'pending' }) },
    {
      label: t('dashboard.statQueueOld'),
      value: n(o.jobs.pending_24h),
      tone: o.jobs.pending_24h > 0 ? 'urgent' : 'default',
      onPress: go('/admin/jobs', { status: 'pending' }),
    },
    {
      label: t('dashboard.statReports'),
      value: n(o.reports.open_targets),
      tone: o.reports.open_targets > 0 ? 'warn' : 'default',
      onPress: go('/admin/reports'),
    },
    {
      label: t('dashboard.statCompaniesPending'),
      value: n(o.companies.pending),
      tone: o.companies.pending > 0 ? 'warn' : 'default',
      onPress: go('/admin/companies', { status: 'pending' }),
    },
    {
      label: t('admin.statAccountsPending'),
      value: n(o.accounts.pending),
      tone: o.accounts.pending > 0 ? 'warn' : 'default',
      onPress: go('/admin/users', { status: 'pending' }),
    },
  ];

  const marketplace: StatCell[] = [
    { label: t('dashboard.statLiveJobs'), value: n(o.jobs.live), tone: 'good', onPress: go('/admin/jobs', { status: 'live' }) },
    {
      label: t('dashboard.statExpiring'),
      value: n(o.jobs.expiring_7d),
      tone: o.jobs.expiring_7d > 0 ? 'warn' : 'default',
      onPress: go('/admin/jobs', { status: 'expiring' }),
    },
    {
      label: t('admin.statNoApplicants'),
      value: n(o.jobs.live_no_applicants),
      tone: o.jobs.live_no_applicants > 0 ? 'warn' : 'default',
      onPress: go('/admin/jobs', { status: 'quiet' }),
    },
    { label: t('admin.statExpired'), value: n(o.jobs.expired), onPress: go('/admin/jobs', { status: 'expired' }) },
    {
      label: t('admin.statApplications7d'),
      value: n(o.applications.last_7d),
      // Against the seven days before, as the website's cell: nothing when nothing moved.
      delta: appsDelta === 0 ? undefined : { value: n(Math.abs(appsDelta)), direction: appsDelta > 0 ? 'up' : 'down' },
      hint: t('dashboard.vsLastWeek'),
      onPress: go('/admin/applications'),
    },
    {
      label: t('admin.statUnopened'),
      value: n(o.applications.unopened_7d),
      tone: o.applications.unopened_7d > 0 ? 'warn' : 'default',
      onPress: go('/admin/applications', { status: 'unopened' }),
    },
  ];

  const population: StatCell[] = [
    { label: t('admin.statCompaniesHiring'), value: n(o.companies.hiring), onPress: go('/admin/companies', { status: 'all' }) },
    { label: t('admin.statCompaniesVerified'), value: n(o.companies.verified), onPress: go('/admin/companies', { status: 'verified' }) },
    { label: t('admin.statCandidates'), value: n(o.accounts.candidates), onPress: go('/admin/users', { role: 'candidate' }) },
    { label: t('admin.statEmployers'), value: n(o.accounts.employers), onPress: go('/admin/users', { role: 'employer' }) },
    { label: t('dashboard.statSignups'), value: n(o.accounts.signups_7d), onPress: go('/admin/users') },
    { label: t('admin.statAgents'), value: n(o.agents.public + o.agents.gated), onPress: go('/admin/agents') },
    { label: t('admin.statSuspendedAccounts'), value: n(o.accounts.suspended), onPress: go('/admin/users', { status: 'rejected' }) },
    { label: t('admin.statSuspendedCompanies'), value: n(o.companies.suspended), onPress: go('/admin/companies', { status: 'suspended' }) },
    {
      label: t('admin.statRestrictedConsultants'),
      value: n(o.agents.restricted),
      onPress: go('/admin/agents', { visibility: 'restricted' }),
    },
  ];

  return (
    <ScrollView
      {...list}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[6] }}
    >
      {viewer?.profile ? <StandingNotice profile={viewer.profile} company={viewer.company} companyOnly /> : null}
      <MailOffBanner />
      <Text tone="mutedForeground">{t('admin.overviewLede')}</Text>

      {/* Anything in the console, by a name, an email, a phone, a title or an id: the search screen answers. */}
      <SearchField
        value={query}
        label={t('admin.search')}
        placeholder={t('admin.searchEverythingPlaceholder')}
        onSearch={(words) => {
          setQuery(words);
          if (words) go('/admin/search', { q: words })();
        }}
      />

      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.needsAttention')}</SectionTitle>
        <StatStrip label={t('admin.needsAttention')} cells={attention} />
      </View>

      <DeletionRequests query={deletions} />

      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.marketplace')}</SectionTitle>
        <StatStrip label={t('admin.marketplace')} cells={marketplace} />
      </View>

      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.population')}</SectionTitle>
        <StatStrip label={t('admin.population')} cells={population} />
        {/* The website's hint on the directory figure — the profiles hidden by their owners — under the strip, where a phone has the room. */}
        <Text variant="caption" tone="mutedForeground" style={{ paddingHorizontal: space[1] }}>
          {`${t('admin.statAgents')}: ${t('admin.statAgentsHint', { hidden: n(o.agents.hidden) })}`}
        </Text>
      </View>

      <Trend query={trend} />

      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
          <SectionTitle>{t('admin.recentActivity')}</SectionTitle>
          <Pressable accessibilityRole="link" onPress={go('/admin/audit')} hitSlop={8} style={{ paddingHorizontal: space[1], minHeight: hitTarget, justifyContent: 'center' }}>
            <Text variant="caption" weight="medium" tone="primary">
              {t('admin.auditLog')}
            </Text>
          </Pressable>
        </View>
        <Panel>
          {o.recent.length === 0 ? (
            <Text variant="small" tone="mutedForeground" style={{ padding: space[4] }}>
              {t('admin.trailEmpty')}
            </Text>
          ) : (
            o.recent.slice(0, 10).map((entry, index) => {
              const path = targetPath(entry);
              const row = (
                <>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="small" weight="medium">
                      {auditLabel(t, entry.action)}
                      {entry.target_label ? <Text variant="small" tone="mutedForeground">{` — ${entry.target_label}`}</Text> : null}
                    </Text>
                    <Text variant="caption" tone="mutedForeground">
                      {`${entry.actor_name ?? t('admin.unknownActor')} · ${formatDateTime(entry.created_at, locale)}`}
                    </Text>
                  </View>
                  {path ? <ForwardChevron size={16} color={colors.mutedForeground} /> : null}
                </>
              );
              const style = {
                flexDirection: 'row' as const,
                alignItems: 'center' as const,
                gap: space[2],
                paddingHorizontal: space[4],
                paddingVertical: space[3],
                borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
                borderTopColor: colors.border,
              };
              // A decision's subject opens where it is decided on; one the console has no screen for (a taxonomy) is read only.
              return path ? (
                <Pressable
                  key={entry.id}
                  accessibilityRole="link"
                  accessibilityLabel={`${auditLabel(t, entry.action)}${entry.target_label ? ` — ${entry.target_label}` : ''}`}
                  onPress={go(path)}
                  style={({ pressed }) => ({ ...style, backgroundColor: pressed ? colors.muted : 'transparent' })}
                >
                  {row}
                </Pressable>
              ) : (
                <View key={entry.id} style={style}>
                  {row}
                </View>
              );
            })
          )}
        </Panel>
      </View>

      <Sections />
    </ScrollView>
  );
}

/**
 * Every part of the console, in the website rail's order and with its badges:
 * for an admin the Admin tab is the whole app (src/lib/tabs.ts), so this list
 * is the way into each screen, as the rail is on the website.
 */
function Sections() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const summary = useAdminSummary().data;
  const sections: readonly { path: string; label: string; waiting?: number }[] = [
    { path: '/admin/jobs', label: t('admin.jobsQueue'), waiting: summary?.queue_total },
    { path: '/admin/companies', label: t('admin.companiesQueue'), waiting: summary?.companies_pending },
    { path: '/admin/reports', label: t('admin.reports'), waiting: summary?.reports_open },
    { path: '/admin/appeals', label: t('admin.appeals'), waiting: summary?.appeals_open },
    { path: '/admin/users', label: t('admin.users'), waiting: summary?.accounts_pending },
    { path: '/admin/applications', label: t('admin.applications') },
    { path: '/admin/agents', label: t('admin.agents') },
    { path: '/admin/search', label: t('admin.search') },
    { path: '/admin/audit', label: t('admin.auditLog') },
    { path: '/admin/taxonomy', label: t('admin.taxonomy') },
    { path: '/admin/email', label: t('admin.emailActivity') },
    { path: '/admin/operations', label: t('admin.operations') },
    { path: '/admin/security', label: t('admin.security') },
  ];
  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>{t('app.admin.overview.sections')}</SectionTitle>
      <Panel>
        {sections.map((section, index) => (
          <Pressable
            key={section.path}
            accessibilityRole="link"
            accessibilityLabel={section.waiting ? `${section.label}: ${formatNumber(section.waiting, locale)}` : section.label}
            onPress={go(section.path)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              minHeight: hitTarget,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
              borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
              borderTopColor: colors.border,
              backgroundColor: pressed ? colors.muted : 'transparent',
            })}
          >
            <Text variant="small" weight="medium" style={{ flex: 1 }}>
              {section.label}
            </Text>
            {section.waiting ? (
              <Text variant="caption" weight="semibold" tone="primary">
                {formatNumber(section.waiting, locale)}
              </Text>
            ) : null}
            <ForwardChevron size={16} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </Panel>
    </View>
  );
}

/**
 * Company owners asking for their account to be deleted, oldest first — only
 * while there is one: an owner waiting on us is a person, not a figure. The
 * lever closes the request and nothing else (closeDeletionRequest records
 * it; the company and the account are dealt with from their files first).
 */
function DeletionRequests({ query }: { query: ReturnType<typeof useDeletionRequests> }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();

  // A list that could not be read is said so, never left out as "nobody is waiting".
  if (query.isError && !query.data) {
    return (
      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.deletionRequests')}</SectionTitle>
        <Panel>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Panel>
      </View>
    );
  }
  if (!query.data?.length) return null;

  const close = (request: DeletionRequest) =>
    openDecision({
      lever: { do: 'closeDeletion', requestId: request.id },
      title: `${t('admin.deletionRequestClose')} — ${request.reference}`,
      body: t('app.admin.overview.closeDeletionBody'),
      confirmLabel: t('admin.deletionRequestClose'),
      reason: 'none',
    });

  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>{t('admin.deletionRequests')}</SectionTitle>
      <Panel>
        <Text variant="small" tone="mutedForeground" style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
          {t('admin.deletionRequestsLede')}
        </Text>
        {query.data.map((request) => (
          <View
            key={request.id}
            style={{
              gap: space[2],
              paddingHorizontal: space[4],
              paddingVertical: space[3],
              borderTopWidth: StyleSheet.hairlineWidth * 2,
              borderTopColor: colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
              {/* The reference as written, left to right, and copyable: it is what the owner quotes. */}
              <Text variant="caption" tone="mutedForeground" selectable style={{ writingDirection: 'ltr' }}>
                {request.reference}
              </Text>
              <Text variant="caption" tone="mutedForeground">
                {formatDate(request.created_at, locale)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
              {request.user_id ? (
                <Link label={request.name ?? request.user_id} onPress={go(`/admin/users/${request.user_id}`)} />
              ) : (
                <Text variant="small" tone="mutedForeground">
                  {t('admin.deletionRequestAccountGone')}
                </Text>
              )}
              {request.company ? (
                <>
                  <Text variant="small" tone="mutedForeground">
                    ·
                  </Text>
                  <Link label={request.company.name} onPress={go(`/admin/companies/${request.company.id}`)} />
                </>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Button
                label={t('admin.deletionRequestClose')}
                accessibilityLabel={`${t('admin.deletionRequestClose')}: ${request.reference}`}
                variant="outline"
                size="sm"
                icon={<CheckCheck size={16} color={colors.foreground} />}
                onPress={() => close(request)}
              />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

/**
 * The platform's activity (admin_trend, 180 days since migration 369) — the
 * website's one chart of three lines, as the Admin board stacks it at phone
 * width: applications, listings published and new accounts, a day to a bar,
 * over a week, a month or a quarter, with a tap for any day's figures.
 */
function Trend({ query }: { query: ReturnType<typeof useAdminTrend> }) {
  const t = useTranslations();
  const { colors } = useTheme();
  if (query.isError && !query.data) {
    return (
      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('dashboard.trendActivityTitle')}</SectionTitle>
        <Panel>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Panel>
      </View>
    );
  }
  if (!query.data) return null;
  return (
    <StackedBars
      title={t('dashboard.trendActivityTitle')}
      hint={t('dashboard.trendActivityHint')}
      days={query.data.days.map((day) => day.d)}
      series={[
        { key: 'applications', label: t('dashboard.statApplications'), color: colors.chart1, values: query.data.days.map((day) => day.applications) },
        { key: 'published', label: t('dashboard.trendPublished'), color: colors.chart2, values: query.data.days.map((day) => day.published) },
        { key: 'signups', label: t('dashboard.trendSignups'), color: colors.chart3, values: query.data.days.map((day) => day.signups) },
      ]}
      empty={t('dashboard.trendEmpty')}
    />
  );
}

/** A name that opens a file of the console. */
function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6} style={{ minHeight: hitTarget - 16, justifyContent: 'center' }}>
      <Text variant="small" weight="medium" tone="primary">
        {label}
      </Text>
    </Pressable>
  );
}

function Panel({ children }: { children: ReactNode }) {
  const { colors, shadow } = useTheme();
  return (
    <View style={{ ...corner('xl'), boxShadow: shadow.card }}>
      <View
        style={{
          ...corner('xl'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          backgroundColor: colors.card,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}
