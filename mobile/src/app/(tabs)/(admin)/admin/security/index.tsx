import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { AbuseLimitRow, AuditLogRow, SecurityEventRow, SecuritySummary } from '@/lib/supabase/database.types';
import { AdminGate, SectionTitle } from '~/components/admin/kit';
import { MailOffBanner } from '~/components/admin/mail-banner';
import { StatStrip, type StatCell } from '~/components/dashboard/stat-strip';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useSecurity, type Security } from '~/features/admin/ops';
import { useTabList } from '~/features/tab-bar';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * What the platform noticed in the last day, and who decided what — the
 * website's /admin/security. Numbers first, because a number that has moved
 * is the reason to read further; under them the two logs: the events the
 * platform recorded on its own, and the trail of decisions people made.
 * Subjects in the event log are hashes, and the actor column is an account
 * id's first characters: nothing here identifies a visitor. The limits at
 * the bottom are the ones the database enforces, shown and never edited
 * from here — a threshold is a decision, made with a SQL statement and a
 * note.
 */
export default function AdminSecurityScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.security') }} />
      <AdminGate>
        <Watch />
      </AdminGate>
    </>
  );
}

/** The screen's rows, one list: the strips, then each log under its heading. */
type Item =
  | { kind: 'strips'; key: string; summary: SecuritySummary }
  | { kind: 'title'; key: string; title: string; hint?: string }
  | { kind: 'empty'; key: string; text: string }
  | { kind: 'event'; key: string; row: SecurityEventRow }
  | { kind: 'audit'; key: string; row: AuditLogRow }
  | { kind: 'limit'; key: string; row: AbuseLimitRow };

function items(data: Security, t: (key: string) => string): Item[] {
  return [
    { kind: 'strips', key: 'strips', summary: data.summary },
    { kind: 'title', key: 'events', title: t('admin.secEventsTitle') },
    ...(data.events.length
      ? data.events.map((row): Item => ({ kind: 'event', key: `event:${row.id}`, row }))
      : [{ kind: 'empty', key: 'events:none', text: t('admin.emptyQueue') } as Item]),
    { kind: 'title', key: 'audit', title: t('admin.secAuditTitle') },
    ...(data.audit.length
      ? data.audit.map((row): Item => ({ kind: 'audit', key: `audit:${row.id}`, row }))
      : [{ kind: 'empty', key: 'audit:none', text: t('admin.emptyQueue') } as Item]),
    { kind: 'title', key: 'limits', title: t('admin.secLimitsTitle'), hint: t('admin.secLimitsHint') },
    ...data.limits.map((row): Item => ({ kind: 'limit', key: `limit:${row.key}`, row })),
  ];
}

function Watch() {
  const t = useTranslations();
  const security = useSecurity();
  const pull = usePullRefresh(() => security.refetch());
  const list = useTabList<FlashListRef<Item>>();

  if (security.isPending) return <LoadingState />;
  if (security.isError && !security.data) return <ErrorState error={security.error} onRetry={() => security.refetch()} />;

  return (
    <FlashList
      {...list}
      data={items(security.data, (key) => t(key as never))}
      keyExtractor={(item) => item.key}
      getItemType={(item) => item.kind}
      renderItem={({ item }) => <Row key={item.key} item={item} />}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={
        <View style={{ gap: space[3], marginBottom: space[2] }}>
          <MailOffBanner />
          <Text variant="small" tone="mutedForeground">
            {t('admin.securityLede')}
          </Text>
        </View>
      }
      {...pull}
    />
  );
}

function Row({ item }: { item: Item }) {
  switch (item.kind) {
    case 'strips':
      return <Strips summary={item.summary} />;
    case 'title':
      return (
        <View style={{ gap: 2, paddingTop: space[4], paddingBottom: space[2] }}>
          <SectionTitle>{item.title}</SectionTitle>
          {item.hint ? (
            <Text variant="caption" tone="mutedForeground" style={{ paddingHorizontal: space[1] }}>
              {item.hint}
            </Text>
          ) : null}
        </View>
      );
    case 'empty':
      return (
        <Card>
          <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {item.text}
          </Text>
        </Card>
      );
    case 'event':
      return <Event row={item.row} />;
    case 'audit':
      return <Audit row={item.row} />;
    case 'limit':
      return <Limit row={item.row} />;
  }
}

/**
 * The website's two strips: what was noticed in the window (events, rate
 * limits, failed sign-ins, rejected uploads), and the state of things
 * (contacts handed out, suspended accounts, open reports, listings in
 * review, sign-ups). A figure with a list behind it opens that list; the
 * rest are this screen's own, and press to nothing, as the website's do.
 */
function Strips({ summary }: { summary: SecuritySummary }) {
  const t = useTranslations();
  const locale = useLocale();
  const n = (value: number) => formatNumber(value, locale);
  const here = () => {};
  const go = (pathname: string, params?: Record<string, string>) => () => router.navigate(params ? { pathname, params } : pathname);

  const noticed: StatCell[] = [
    {
      label: t('admin.secEvents'),
      value: n(summary.events_total),
      tone: summary.events_critical > 0 ? 'urgent' : summary.events_warning > 0 ? 'warn' : 'default',
      onPress: here,
    },
    { label: t('admin.secRateLimited'), value: n(summary.rate_limited_24h), tone: summary.rate_limited_24h > 0 ? 'warn' : 'default', onPress: here },
    {
      label: t('admin.secAuthFailures'),
      value: n(summary.auth_failures_24h),
      tone: summary.auth_failures_24h > 20 ? 'warn' : 'default',
      onPress: here,
    },
    {
      label: t('admin.secUploadsRejected'),
      value: n(summary.uploads_rejected_24h),
      tone: summary.uploads_rejected_24h > 0 ? 'accent' : 'default',
      onPress: here,
    },
  ];
  const handed: StatCell[] = [
    { label: t('admin.secReveals'), value: n(summary.reveals_24h), onPress: here },
    { label: t('admin.secSuspended'), value: n(summary.accounts_suspended), onPress: go('/admin/users', { status: 'rejected' }) },
    { label: t('admin.secReportsOpen'), value: n(summary.reports_open), onPress: go('/admin/reports') },
    { label: t('admin.secJobsPending'), value: n(summary.jobs_pending), onPress: go('/admin/jobs', { status: 'pending' }) },
    { label: t('admin.secSignups'), value: n(summary.signups_24h), onPress: go('/admin/users') },
  ];

  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>{t('admin.securityNoticed')}</SectionTitle>
      <StatStrip label={t('admin.securityNoticed')} cells={noticed} />
      <SectionTitle>{t('admin.securityHanded')}</SectionTitle>
      <StatStrip label={t('admin.securityHanded')} cells={handed} />
    </View>
  );
}

/** A code word, as written: left to right whatever the language. */
function Code({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <Text variant="caption" weight={muted ? 'regular' : 'medium'} tone={muted ? 'mutedForeground' : 'foreground'} style={{ writingDirection: 'ltr' }}>
      {children}
    </Text>
  );
}

/** Something the platform noticed: when, what kind, how serious, and a hash or an id's start for who. */
function Event({ row }: { row: SecurityEventRow }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const subject = row.actor_id ? row.actor_id.slice(0, 8) : row.subject_hash ? row.subject_hash.slice(0, 16) : '—';
  return (
    <View style={{ gap: 2, paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <View style={{ flex: 1 }}>
          <Code>{row.kind}</Code>
        </View>
        {/* The severity word is the database's own, as the website prints it. */}
        <Badge variant={row.severity === 'critical' ? 'destructive' : row.severity === 'warning' ? 'warning' : 'outline'} label={row.severity} />
      </View>
      <Text variant="caption" tone="mutedForeground">
        {`${formatDateTime(row.created_at, locale)} · `}
        <Code muted>{subject}</Code>
      </Text>
    </View>
  );
}

/** A decision somebody made, as the table it changed recorded it: who (role and id's start), what, on what. */
function Audit({ row }: { row: AuditLogRow }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const from = row.metadata?.from;
  const to = row.metadata?.to;
  const target = `${row.target_type}${row.target_id ? ` · ${row.target_id.slice(0, 8)}` : ''}${
    typeof from === 'string' && typeof to === 'string' ? ` · ${from} → ${to}` : ''
  }`;
  return (
    <View style={{ gap: 2, paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Code>{row.action}</Code>
      <Code muted>{target}</Code>
      <Text variant="caption" tone="mutedForeground">
        {`${formatDateTime(row.created_at, locale)} · `}
        <Code muted>{`${row.actor_role}${row.actor_id ? ` · ${row.actor_id.slice(0, 8)}` : ''}`}</Code>
      </Text>
    </View>
  );
}

/** A threshold the database enforces: the key, its window in minutes, and the most it allows. */
function Limit({ row }: { row: AbuseLimitRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2, paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Code>{row.key}</Code>
      <Text variant="caption" tone="mutedForeground">
        {`${t('admin.secLimitWindow')}: ${formatNumber(Math.round(row.window_seconds / 60), locale)} · ${t('admin.secLimitMax')}: ${formatNumber(row.max_hits, locale)}`}
      </Text>
    </View>
  );
}
