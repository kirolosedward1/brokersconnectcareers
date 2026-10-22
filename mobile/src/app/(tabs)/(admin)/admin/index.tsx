import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime, formatNumber } from '@/lib/format';
import { AdminGate, openOnWebsite, SectionTitle } from '~/components/admin/kit';
import { StatStrip } from '~/components/dashboard/stat-strip';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { ForwardChevron } from '~/components/ui/icons';
import { ExternalLink } from '~/components/ui/lucide';
import { ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useAdminOverview } from '~/features/admin/queries';
import { useTabList } from '~/features/tab-bar';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/**
 * The Admin tab — the website's /admin, where an operator starts the day: what
 * is waiting on a person, each figure the way to its queue; the marketplace
 * in a few figures; and the decisions made lately, by whom. Everything the
 * app's console does not carry — search, the audit log, taxonomy, one
 * account's file — is a tap away on the website.
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

function Overview() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const overview = useAdminOverview();
  const pull = usePullRefresh(() => overview.refetch());
  const list = useTabList();
  const n = (value: number) => formatNumber(value, locale);

  if (overview.isPending) return <LoadingState />;
  if (overview.isError && !overview.data) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  const o = overview.data;

  return (
    <ScrollView
      {...list}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[6] }}
    >
      <Text tone="mutedForeground">{t('admin.overviewLede')}</Text>

      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.needsAttention')}</SectionTitle>
        <StatStrip
          label={t('admin.needsAttention')}
          cells={[
            {
              label: t('dashboard.statQueue'),
              value: n(o.jobs.pending),
              tone: o.jobs.pending_24h > 0 ? 'urgent' : o.jobs.pending > 0 ? 'accent' : 'default',
              onPress: () => router.push('/admin/jobs'),
            },
            {
              label: t('dashboard.statReports'),
              value: n(o.reports.open_targets),
              tone: o.reports.open_targets > 0 ? 'warn' : 'default',
              onPress: () => router.push('/admin/reports'),
            },
            {
              label: t('dashboard.statCompaniesPending'),
              value: n(o.companies.pending),
              tone: o.companies.pending > 0 ? 'warn' : 'default',
              onPress: () => router.push('/admin/companies'),
            },
            {
              label: t('admin.statAccountsPending'),
              value: n(o.accounts.pending),
              tone: o.accounts.pending > 0 ? 'warn' : 'default',
              onPress: () => router.push('/admin/users'),
            },
          ]}
        />
        {o.jobs.pending_24h > 0 ? (
          <Text variant="caption" tone="destructive">
            {`${t('dashboard.statQueueOld')}: ${n(o.jobs.pending_24h)}`}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.marketplace')}</SectionTitle>
        <StatStrip
          label={t('admin.marketplace')}
          cells={[
            {
              label: t('dashboard.statLiveJobs'),
              value: n(o.jobs.live),
              tone: 'good',
              onPress: () => openOnWebsite('/admin/jobs?status=live'),
            },
            {
              label: t('admin.statApplications7d'),
              value: n(o.applications.last_7d),
              onPress: () => openOnWebsite('/admin/applications'),
            },
            { label: t('dashboard.statSignups'), value: n(o.accounts.signups_7d), onPress: () => openOnWebsite('/admin/users') },
            {
              label: t('admin.statSuspendedAccounts'),
              value: n(o.accounts.suspended),
              onPress: () => router.push({ pathname: '/admin/users', params: { status: 'rejected' } }),
            },
          ]}
        />
      </View>

      <View style={{ gap: space[2] }}>
        <SectionTitle>{t('admin.recentActivity')}</SectionTitle>
        <Panel>
          {o.recent.length === 0 ? (
            <Text variant="small" tone="mutedForeground" style={{ padding: space[4] }}>
              {t('admin.trailEmpty')}
            </Text>
          ) : (
            o.recent.slice(0, 10).map((entry, index) => (
              <View
                key={entry.id}
                style={{
                  gap: 2,
                  paddingHorizontal: space[4],
                  paddingVertical: space[3],
                  borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
                  borderTopColor: colors.border,
                }}
              >
                <Text variant="small" weight="medium">
                  {auditLabel(t, entry.action)}
                  {entry.target_label ? <Text variant="small" tone="mutedForeground">{` — ${entry.target_label}`}</Text> : null}
                </Text>
                <Text variant="caption" tone="mutedForeground">
                  {`${entry.actor_name ?? t('admin.unknownActor')} · ${formatDateTime(entry.created_at, locale)}`}
                </Text>
              </View>
            ))
          )}
        </Panel>
      </View>

      <Panel>
        <Pressable
          accessibilityRole="link"
          accessibilityHint={t('app.admin.fullConsoleHint')}
          onPress={() => openOnWebsite('/admin')}
          style={({ pressed }) => ({
            minHeight: hitTarget + 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            paddingHorizontal: space[4],
            paddingVertical: space[3],
            backgroundColor: pressed ? colors.muted : 'transparent',
          })}
        >
          <ExternalLink size={18} color={colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium">{t('app.admin.fullConsole')}</Text>
            <Text variant="caption" tone="mutedForeground">
              {t('app.admin.fullConsoleHint')}
            </Text>
          </View>
          <ForwardChevron size={18} color={colors.mutedForeground} />
        </Pressable>
      </Panel>
    </ScrollView>
  );
}

/** The website's audit label for an action word (`job.approved`), or the word itself for one it does not name. */
function auditLabel(t: ReturnType<typeof useTranslations>, action: string): string {
  const key = `admin.auditAction.${action.replace('.', '_')}`;
  return t.has(key as never) ? t(key as never) : action;
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
