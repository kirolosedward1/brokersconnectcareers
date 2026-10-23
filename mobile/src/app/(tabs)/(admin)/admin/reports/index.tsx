import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { AdminReportDetail, CompanySignal, CompanySignals, JobStatus, ReportTargetType, SafetyFlag } from '@/lib/supabase/database.types';
import { openDecision, type Decision } from '~/components/admin/decision-sheet';
import { AdminGate, FlagList } from '~/components/admin/kit';
import { ReportFilterSheet } from '~/components/admin/report-filters';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { AlertTriangle, Ban, CheckCheck, EyeOff, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, ThumbsUp, UserX } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  canDismissAbusive,
  canTakeDown,
  CLOSE_MAX,
  flattenCases,
  flattenClosed,
  freshReporter,
  isOpenView,
  NO_FILTERS,
  readReportParams,
  REPORT_TYPES,
  REPORT_VIEWS,
  SHOWN_REPORTS,
  targetPath,
  useClosedReports,
  useReportCases,
  type ClosedView,
  type OpenView,
  type ReportCase,
  type ReportFilters,
  type ReportView,
} from '~/features/admin/reports';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * Reports — the website's /admin/reports, every view and filter of it.
 *
 * New and under review are cases, one per thing reported: the most serious
 * first, then the most people, then the longest waiting, aggregated in the
 * database (admin_report_cases). Resolved and dismissed are the reports
 * themselves, newest decision first. Beside each case: what the listing or
 * company says about itself (text flags), what the company has been doing
 * (review signals), and who the reporters are — new accounts, a record of
 * groundless reports, employers. None of it decides anything; every lever is
 * a person's decision, and the take-down ones need a reason, which the owner
 * is sent. A case whose target was deleted can only be closed, keeping what
 * was said when it was reported.
 */
export default function AdminReportsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.reports') }} />
      <AdminGate>
        <Reports />
      </AdminGate>
    </>
  );
}

const JOB_STATUSES: readonly string[] = ['draft', 'pending_review', 'active', 'expired', 'closed', 'rejected'];

const STATUS_VARIANT: Record<JobStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
  draft: 'default',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

/** A page of the console, by the website's own path (links.ts opens each natively). */
function openPath(path: string) {
  router.navigate(path as Href);
}

function Reports() {
  const params = useLocalSearchParams<{ status?: string; type?: string; reason?: string; severity?: string; from?: string; to?: string; repeat?: string }>();
  // The view and filters a link names, read once: the chips take it from here.
  const [initial] = useState(() => readReportParams(params));
  const [view, setView] = useState<ReportView>(initial.view);
  const [filters, setFilters] = useState<ReportFilters>(initial.filters);
  const [sheet, setSheet] = useState(false);
  const grouped = isOpenView(view);

  const header = (
    <Header view={view} filters={filters} grouped={grouped} onView={setView} onFilters={setFilters} onOpenSheet={() => setSheet(true)} />
  );

  return (
    <View style={{ flex: 1 }}>
      {grouped ? (
        <CaseList view={view} filters={filters} header={header} />
      ) : (
        <ClosedList view={view} filters={filters} header={header} />
      )}
      {/* The sheet is the screen's, not a card's: a card drawn again would take it with it. */}
      <ReportFilterSheet
        visible={sheet}
        filters={filters}
        grouped={grouped}
        onClose={() => setSheet(false)}
        onApply={(next) => {
          setFilters(next);
          setSheet(false);
        }}
      />
    </View>
  );
}

/** The views, the kind reported, and the finer filters — the website's tab rows and form, as chips. */
function Header({
  view,
  filters,
  grouped,
  onView,
  onFilters,
  onOpenSheet,
}: {
  view: ReportView;
  filters: ReportFilters;
  grouped: boolean;
  onView: (view: ReportView) => void;
  onFilters: (filters: ReportFilters) => void;
  onOpenSheet: () => void;
}) {
  const t = useTranslations();
  const { colors } = useTheme();

  // Each finer filter set, a chip that removes it.
  const active: { key: string; label: string; clear: () => void }[] = [];
  if (filters.reason !== 'all') {
    active.push({ key: 'reason', label: t(`reportReason.${filters.reason}`), clear: () => onFilters({ ...filters, reason: 'all' }) });
  }
  if (filters.severity !== 'any') {
    active.push({
      key: 'severity',
      label: filters.severity === '3' ? t('admin.severityOnlyHigh') : t('admin.severityMediumUp'),
      clear: () => onFilters({ ...filters, severity: 'any' }),
    });
  }
  if (filters.from) active.push({ key: 'from', label: `${t('admin.filterFrom')} ${filters.from}`, clear: () => onFilters({ ...filters, from: undefined }) });
  if (filters.to) active.push({ key: 'to', label: `${t('admin.filterTo')} ${filters.to}`, clear: () => onFilters({ ...filters, to: undefined }) });
  if (grouped && filters.repeat) active.push({ key: 'repeat', label: t('admin.filterRepeat'), clear: () => onFilters({ ...filters, repeat: false }) });

  return (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.reportsLede')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('admin.colStatus')}
        contentContainerStyle={{ gap: space[2] }}
      >
        {REPORT_VIEWS.map((option) => (
          <Chip key={option} radio label={t(`admin.reportView.${option}`)} selected={option === view} onPress={() => onView(option)} />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('admin.reportTarget')}
        contentContainerStyle={{ gap: space[2] }}
      >
        {REPORT_TYPES.map((option) => (
          <Chip
            key={option}
            radio
            label={option === 'all' ? t('admin.filterAll') : t(`admin.kind.${option}`)}
            selected={option === filters.type}
            onPress={() => onFilters({ ...filters, type: option })}
          />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        <Chip
          label={t('jobs.filters')}
          accessibilityLabel={t('admin.filtersLabel')}
          icon={<SlidersHorizontal size={16} color={colors.foreground} />}
          feedback={false}
          onPress={onOpenSheet}
        />
        {active.map((filter) => (
          <Chip
            key={filter.key}
            removable
            label={filter.label}
            accessibilityLabel={t('jobs.removeFilter', { name: filter.label })}
            onPress={filter.clear}
          />
        ))}
        {active.length > 1 ? (
          <Button label={t('admin.clearFilters')} variant="ghost" size="sm" onPress={() => onFilters({ ...NO_FILTERS, type: filters.type })} />
        ) : null}
      </View>
    </View>
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

/** The open views: cases, twenty a page. */
function CaseList({ view, filters, header }: { view: OpenView; filters: ReportFilters; header: ReactNode }) {
  const t = useTranslations();
  const cases = useReportCases(view, filters);
  const nextPage = useNextPage(cases);
  const pull = usePullRefresh(() => cases.refetch());
  const list = useTabList<FlashListRef<ReportCase>>();
  const rows = useMemo(() => flattenCases(cases.data?.pages), [cases.data]);
  const total = cases.data?.pages[0]?.total ?? 0;

  let body: ReactNode = null;
  if (cases.isPending) body = <LoadingState />;
  else if (cases.isError && !cases.data) body = <ErrorState error={cases.error} onRetry={() => cases.refetch()} />;

  return (
    <FlashList
      {...list}
      data={body ? [] : rows}
      keyExtractor={(row) => `${row.target_type}:${row.target_id}`}
      renderItem={({ item }) => <CaseCard key={`${item.target_type}:${item.target_id}`} item={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={
        <>
          {header}
          {total > 0 ? (
            <Text variant="small" tone="mutedForeground" style={{ marginBottom: space[3] }}>
              {t.markup('app.admin.reports.caseTotal', { count: total, ...markupTags })}
            </Text>
          ) : null}
        </>
      }
      ListEmptyComponent={body ?? <EmptyState icon={ShieldCheck} title={t('admin.emptyQueue')} />}
      ListFooterComponent={<PageFooter query={cases} />}
      onEndReached={nextPage}
      onEndReachedThreshold={0.5}
      {...pull}
    />
  );
}

/** The closed views: the reports themselves, newest decision first, thirty a page. */
function ClosedList({ view, filters, header }: { view: ClosedView; filters: ReportFilters; header: ReactNode }) {
  const t = useTranslations();
  const reports = useClosedReports(view, filters);
  const nextPage = useNextPage(reports);
  const pull = usePullRefresh(() => reports.refetch());
  const list = useTabList<FlashListRef<AdminReportDetail>>();
  const rows = useMemo(() => flattenClosed(reports.data?.pages), [reports.data]);
  const total = reports.data?.pages[0]?.total ?? 0;

  let body: ReactNode = null;
  if (reports.isPending) body = <LoadingState />;
  else if (reports.isError && !reports.data) body = <ErrorState error={reports.error} onRetry={() => reports.refetch()} />;

  return (
    <FlashList
      {...list}
      data={body ? [] : rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <ClosedCard key={item.id} report={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={
        <>
          {header}
          {total > 0 ? (
            <Text variant="small" tone="mutedForeground" style={{ marginBottom: space[3] }}>
              {t.markup('app.admin.reportCount', { count: total, ...markupTags })}
            </Text>
          ) : null}
        </>
      }
      ListEmptyComponent={body ?? <EmptyState icon={ShieldCheck} title={t('admin.emptyQueue')} />}
      ListFooterComponent={<PageFooter query={reports} />}
      onEndReached={nextPage}
      onEndReachedThreshold={0.5}
      {...pull}
    />
  );
}

/** The target as it is now: deleted, suspended, restricted, or a listing's status. */
function StateBadge({ item }: { item: { target_type: ReportTargetType; target_state: string } }) {
  const t = useTranslations();
  if (item.target_state === 'deleted') return <Badge variant="outline" label={t('admin.stateDeleted')} />;
  if (item.target_state === 'suspended' || item.target_state === 'company_suspended') {
    return <Badge variant="destructive" label={t('admin.suspended')} />;
  }
  if (item.target_state === 'restricted') return <Badge variant="destructive" label={t('admin.restricted')} />;
  if (item.target_type === 'job' && JOB_STATUSES.includes(item.target_state)) {
    const status = item.target_state as JobStatus;
    return <Badge variant={STATUS_VARIANT[status]} label={t(`jobStatus.${status}`)} />;
  }
  return null;
}

function CaseCard({ item }: { item: ReportCase }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const n = (value: number) => formatNumber(value, locale);
  const deleted = item.target_state === 'deleted';
  const live = !deleted;
  const actionable = canTakeDown(item);
  const label = localized(locale, item.label_ar ?? '', item.label_en) || t('admin.untitled');
  const reasons = formatList([...new Set(item.reasons)].map((reason) => t(`reportReason.${reason}`)), locale);
  const snapshot = item.details[0]?.target_snapshot;
  // A case holds only open and investigating reports, so its ids are the ones a close-by-id lever takes (at most the action's cap).
  const openIds = item.report_ids.slice(0, CLOSE_MAX);

  const lever = (decision: Omit<Decision, 'lever'> & { status: 'investigating' | 'resolved' | 'dismissed'; takeAction?: boolean }) => {
    const { status, takeAction, ...words } = decision;
    openDecision({ ...words, lever: { do: 'reports', targetType: item.target_type, targetId: item.target_id, status, takeAction } });
  };
  const close = (status: 'resolved' | 'dismissed', title: string) =>
    openDecision({
      lever: { do: 'closeReports', ids: openIds, status },
      title,
      body: t('admin.closeDeletedBody'),
      confirmLabel: title,
      reason: 'optional',
    });

  const takeDown = {
    job: { label: t('admin.resolveTakeDownJob'), body: t('admin.resolveTakeDownJobBody'), icon: EyeOff },
    company: { label: t('admin.resolveSuspendCompany'), body: t('admin.resolveSuspendCompanyBody'), icon: Ban },
    agent: { label: t('admin.resolveRestrictAgent'), body: t('admin.resolveRestrictAgentBody'), icon: ShieldAlert },
  }[item.target_type];
  const TakeDownIcon = takeDown.icon;

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="mutedForeground">
          {t(`admin.kind.${item.target_type}`)}
        </Text>
        {live ? (
          <Pressable accessibilityRole="link" onPress={() => openPath(targetPath(item.target_type, item.target_id))}>
            <Text weight="semibold" tone="primary">
              {label}
            </Text>
          </Pressable>
        ) : (
          <Text weight="semibold">{label}</Text>
        )}
        {item.target_type === 'job' && item.company_name_ar ? (
          item.company_id && live ? (
            <Pressable accessibilityRole="link" onPress={() => openPath(targetPath('company', item.company_id as string))}>
              <Text variant="small" tone="mutedForeground">
                {localized(locale, item.company_name_ar, item.company_name_en)}
              </Text>
            </Pressable>
          ) : (
            <Text variant="small" tone="mutedForeground">
              {localized(locale, item.company_name_ar, item.company_name_en)}
            </Text>
          )
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        <SeverityBadge severity={item.max_severity} />
        <StateBadge item={item} />
        <Badge variant={item.reporters > 1 ? 'destructive' : 'outline'} label={t('admin.reportersCount', { count: n(item.reporters) })} />
        {item.system_flags ? <Badge variant="warning" label={t('admin.systemFlagShort')} /> : null}
      </View>

      <Text variant="small">{reasons}</Text>

      {item.fresh_reporters || item.noisy_reporters || item.employer_reporters ? (
        <View style={{ gap: 2 }}>
          {item.fresh_reporters ? (
            <Text variant="caption" tone="mutedForeground">
              {t('admin.freshReporters', { count: n(item.fresh_reporters) })}
            </Text>
          ) : null}
          {item.noisy_reporters ? (
            <Text variant="caption" tone="warning">
              {t('admin.noisyReporters', { count: n(item.noisy_reporters) })}
            </Text>
          ) : null}
          {item.employer_reporters ? (
            <Text variant="caption" tone="mutedForeground">
              {t('admin.employerReporters', { count: n(item.employer_reporters) })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {deleted && snapshot?.excerpt ? (
        <View style={{ gap: 2, paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.border }}>
          <Text variant="caption" tone="mutedForeground">
            {t('admin.snapshotLabel')}
          </Text>
          <Text variant="small" numberOfLines={4}>
            {snapshot.excerpt}
          </Text>
        </View>
      ) : null}

      {item.job && (item.job.flags.length || item.job.company.signals.length) ? (
        <Signals flags={item.job.flags} signals={item.job.company} />
      ) : null}
      {item.company && (item.company.flags.length || item.company.signals.signals.length) ? (
        <Signals flags={item.company.flags} signals={item.company.signals} />
      ) : null}

      {item.details.slice(0, SHOWN_REPORTS).map((report) => (
        <ReportLine key={report.id} report={report} withLevers />
      ))}
      {item.reports > SHOWN_REPORTS ? (
        <Text variant="caption" tone="mutedForeground">
          {t.markup('app.admin.reportCount', { count: item.reports, ...markupTags })}
        </Text>
      ) : null}

      {live ? (
        <View style={{ gap: space[2] }}>
          {item.open_reports > 0 ? (
            <Button
              label={t('admin.investigate')}
              variant="outline"
              size="sm"
              icon={<Search size={16} color={colors.foreground} />}
              onPress={() =>
                lever({
                  status: 'investigating',
                  title: t('admin.investigate'),
                  body: t('admin.investigateBody'),
                  confirmLabel: t('admin.investigate'),
                  reason: 'optional',
                })
              }
            />
          ) : null}
          {actionable ? (
            <Button
              label={takeDown.label}
              variant="destructive"
              size="sm"
              icon={<TakeDownIcon size={16} color={colors.destructiveForeground} />}
              onPress={() =>
                lever({
                  status: 'resolved',
                  takeAction: true,
                  title: takeDown.label,
                  body: takeDown.body,
                  confirmLabel: takeDown.label,
                  destructive: true,
                  reason: 'required',
                  // Who reads it: a listing's company and a company's members get the
                  // reason with the take-down, a consultant gets it on their profile.
                  reasonLabel: item.target_type === 'agent' ? t('admin.reasonToConsultant') : t('admin.reasonToCompany'),
                })
              }
            />
          ) : null}
          <Button
            label={t('admin.resolveOnly')}
            variant="outline"
            size="sm"
            icon={<CheckCheck size={16} color={colors.foreground} />}
            onPress={() =>
              lever({
                status: 'resolved',
                title: t('admin.resolveOnly'),
                body: t('admin.resolveOnlyBody'),
                confirmLabel: t('admin.resolveOnly'),
                reason: 'optional',
              })
            }
          />
          <Button
            label={t('admin.dismissReports')}
            variant="ghost"
            size="sm"
            icon={<ThumbsUp size={16} color={colors.foreground} />}
            onPress={() =>
              lever({
                status: 'dismissed',
                title: t('admin.dismissReports'),
                body: t('admin.dismissBody'),
                confirmLabel: t('admin.dismissReports'),
                reason: 'optional',
              })
            }
          />
        </View>
      ) : openIds.length ? (
        // What was reported is gone: the reports can only be closed, each keeping its snapshot.
        <View style={{ gap: space[2] }}>
          <Button
            label={t('admin.closeDeletedResolve')}
            variant="outline"
            size="sm"
            icon={<CheckCheck size={16} color={colors.foreground} />}
            onPress={() => close('resolved', t('admin.closeDeletedResolve'))}
          />
          <Button
            label={t('admin.closeDeletedDismiss')}
            variant="ghost"
            size="sm"
            icon={<ThumbsUp size={16} color={colors.foreground} />}
            onPress={() => close('dismissed', t('admin.closeDeletedDismiss'))}
          />
        </View>
      ) : null}
    </Card>
  );
}

/** A closed report: what it was about, when it was decided, and the report itself. */
function ClosedCard({ report }: { report: AdminReportDetail }) {
  const t = useTranslations();
  const locale = useLocale();
  const label = localized(locale, report.target_snapshot.label_ar ?? '', report.target_snapshot.label_en ?? null) || t('admin.untitled');
  const line = [
    t(`admin.kind.${report.target_type}`),
    report.resolved_at ? formatDate(report.resolved_at, locale) : null,
    report.target_live ? null : t('admin.stateDeleted'),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="caption" tone="mutedForeground">
        {line}
      </Text>
      {report.target_live ? (
        <Pressable accessibilityRole="link" onPress={() => openPath(targetPath(report.target_type, report.target_id))}>
          <Text weight="medium" tone="primary">
            {label}
          </Text>
        </Pressable>
      ) : (
        <Text weight="medium">{label}</Text>
      )}
      <ReportLine report={report} withLevers={false} />
    </Card>
  );
}

/** What the reporter alleged, ranked — from the reason alone, not judged. */
function SeverityBadge({ severity }: { severity: number }) {
  const t = useTranslations();
  return (
    <Badge
      variant={severity >= 3 ? 'destructive' : severity === 2 ? 'warning' : 'outline'}
      label={t(`admin.severity.${severity === 3 ? '3' : severity === 2 ? '2' : '1'}`)}
    />
  );
}

/**
 * One report: the reason and its severity, what was written, and who sent
 * it — their record of reports, and the two facts that colour it (an account
 * under a week old, reporting restricted) — with the dismiss-as-bad-faith
 * lever on a person's report that is still open.
 */
function ReportLine({ report, withLevers }: { report: AdminReportDetail; withLevers: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const n = (value: number) => formatNumber(value, locale);
  const dismissAbusive = () =>
    openDecision({
      lever: { do: 'closeReports', ids: [report.id], status: 'dismissed', abusive: true },
      title: t('admin.dismissAbusive'),
      body: t('admin.dismissAbusiveBody'),
      confirmLabel: t('admin.dismissAbusive'),
      reason: 'required',
      reasonLabel: t('admin.abusiveReasonLabel'),
    });

  return (
    <View style={{ gap: space[1], padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
        <Text variant="small" weight="medium">
          {t(`reportReason.${report.reason}`)}
        </Text>
        <SeverityBadge severity={report.severity} />
        {report.status === 'investigating' ? <Badge variant="warning" label={t('admin.reportStatus.investigating')} /> : null}
        {report.abusive ? <Badge variant="warning" label={t('admin.badFaith')} /> : null}
      </View>
      {report.detail ? (
        <Text variant="small" tone="mutedForeground">
          {report.detail}
        </Text>
      ) : null}

      {report.source === 'system' ? (
        <Text variant="caption" tone="mutedForeground">
          {`${t('admin.systemFlag')} · ${formatDate(report.created_at, locale)}`}
        </Text>
      ) : (
        <View style={{ gap: space[1] }}>
          <Text variant="caption" tone="mutedForeground">
            {report.reporter_id ? (
              <Text
                variant="caption"
                tone="primary"
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: report.reporter_id as string } })}
              >
                {report.reporter_name ?? t('admin.unknownActor')}
              </Text>
            ) : (
              t('admin.reporterGone')
            )}
            {report.reporter_role === 'employer'
              ? ` · ${t('admin.reporterEmployer')}${
                  report.reporter_company_ar ? ` (${localized(locale, report.reporter_company_ar, report.reporter_company_en)})` : ''
                }`
              : ''}
            {` · ${formatDate(report.created_at, locale)}`}
          </Text>
          {report.reporter_id ? (
            <Text variant="caption" tone="mutedForeground">
              {t('admin.reporterRecord', {
                filed: n(report.reporter_filed),
                dismissed: n(report.reporter_dismissed),
                abusive: n(report.reporter_abusive),
              })}
            </Text>
          ) : null}
          {freshReporter(report) || report.reporter_restricted ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
              {freshReporter(report) ? <Badge variant="warning" label={t('admin.reporterNewAccount')} /> : null}
              {report.reporter_restricted ? <Badge variant="destructive" label={t('admin.reporterBanned')} /> : null}
            </View>
          ) : null}
        </View>
      )}

      {withLevers && canDismissAbusive(report) ? (
        <View style={{ flexDirection: 'row', marginTop: space[1] }}>
          <Button
            label={t('admin.dismissAbusive')}
            accessibilityLabel={`${t('admin.dismissAbusive')}: ${report.reporter_name ?? t('admin.reporterGone')}`}
            variant="ghost"
            size="sm"
            icon={<UserX size={16} color={colors.foreground} />}
            onPress={dismissAbusive}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * What the console shows beside a live case: the listing's or company's own
 * words that deserve a second look (FlagList), and the company's raised
 * review signals, one sentence each — the website's CompanySignalList. Facts
 * to weigh, never verdicts; the companies a signal names open their pages.
 */
function Signals({ flags, signals }: { flags: SafetyFlag[]; signals: CompanySignals }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[2], paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.warning }}>
      <FlagList flags={flags} />
      {signals.signals.map((signal) => (
        <SignalLine key={signal.signal} signal={signal} />
      ))}
    </View>
  );
}

function SignalLine({ signal }: { signal: CompanySignal }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const { colors } = useTheme();
  const n = (value: number) => formatNumber(value, locale);

  const companies = (refs: { id: string; name_ar: string; name_en: string | null; suspended: boolean }[]) =>
    refs.slice(0, 5).map((ref, index) => (
      <Text key={ref.id} variant="small">
        {index ? t('listSeparator') : ' '}
        <Text variant="small" tone="primary" accessibilityRole="link" onPress={() => openPath(targetPath('company', ref.id))}>
          {localized(locale, ref.name_ar, ref.name_en)}
        </Text>
        {ref.suspended ? <Text variant="small" tone="destructive">{` (${t('suspended')})`}</Text> : null}
      </Text>
    ));

  let line: ReactNode;
  switch (signal.signal) {
    case 'mass_posting':
      line = t('signal.mass_posting', { day: n(signal.day), week: n(signal.week) });
      break;
    case 'rejections':
      line = t('signal.rejections', { count: n(signal.count) });
      break;
    case 'duplicate_listings':
      line = t('signal.duplicate_listings', { count: n(signal.count) });
      break;
    case 'copied_listings':
      line = (
        <>
          {t('signal.copied_listings')}
          {companies(signal.companies)}
        </>
      );
      break;
    case 'reported':
      line = t('signal.reported', { reporters: n(signal.reporters), reports: n(signal.reports) });
      break;
    case 'company_text':
      line = t('signal.company_text', { flags: signal.flags.map((flag) => t(`flag.${flag.flag}`)).join(t('listSeparator')) });
      break;
    case 'flagged_listings':
      line = t('signal.flagged_listings', { count: n(signal.count) });
      break;
    case 'shared_phone':
      line = (
        <>
          {t('signal.shared_phone')}
          {companies(signal.companies)}
        </>
      );
      break;
    case 'phone_of_suspended_account':
      line = t('signal.phone_of_suspended_account', { count: n(signal.count) });
      break;
    case 'shared_website':
      line = (
        <>
          {t('signal.shared_website', { site: signal.site })}
          {companies(signal.companies)}
        </>
      );
      break;
    default:
      return null;
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
      <AlertTriangle size={14} color={colors.warning} style={{ marginTop: 4 }} />
      <Text variant="small" style={{ flex: 1 }}>
        {line}
      </Text>
    </View>
  );
}
