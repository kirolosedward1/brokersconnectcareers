import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { openDecision, type Decision } from '~/components/admin/decision-sheet';
import { AdminGate, openOnWebsite } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Ban, CheckCheck, ExternalLink, EyeOff, Search, ShieldAlert, ShieldCheck, ThumbsUp } from '~/components/ui/lucide';
import { Segmented } from '~/components/ui/segmented';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { SHOWN_REPORTS, useReportCases, type ReportCase, type ReportView } from '~/features/admin/queries';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * Open reports, one case per thing reported — the website's /admin/reports:
 * the most serious first, then the most people, then the longest waiting,
 * in two queues as the website has them: new, and under investigation (a
 * case moves there when a moderator takes it; its levers go with it).
 * Beside each case, who the reporters are (new accounts, a record of
 * groundless reports, employers): what separates a real pile of complaints
 * from a pile-on. Every lever is a person's decision, and the take-down ones
 * need a reason, which the owner is sent.
 */
export default function AdminReportsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.reports') }} />
      <AdminGate>
        <Cases />
      </AdminGate>
    </>
  );
}

function Cases() {
  const t = useTranslations();
  const [view, setView] = useState<ReportView>('new');
  const cases = useReportCases(view);
  const pull = usePullRefresh(() => cases.refetch());
  const list = useTabList<FlashListRef<ReportCase>>();

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Segmented
        label={t('admin.colStatus')}
        options={[
          { value: 'new', label: t('admin.reportView.new') },
          { value: 'under_review', label: t('admin.reportView.under_review') },
        ]}
        value={view}
        onChange={setView}
      />
      {cases.data && cases.data.cases.length < cases.data.total ? (
        <Text variant="small" tone="mutedForeground">
          {t.markup('app.admin.showing', { shown: cases.data.cases.length, total: cases.data.total, ...markupTags })}
        </Text>
      ) : null}
    </View>
  );

  let body: React.ReactNode = null;
  if (cases.isPending) body = <LoadingState />;
  else if (cases.isError && !cases.data) body = <ErrorState error={cases.error} onRetry={() => cases.refetch()} />;

  return (
    <FlashList
      {...list}
      data={body ? [] : (cases.data?.cases ?? [])}
      keyExtractor={(row) => `${row.target_type}:${row.target_id}`}
      renderItem={({ item }) => <CaseCard key={`${item.target_type}:${item.target_id}`} item={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={header}
      ListEmptyComponent={body ?? <EmptyState icon={ShieldCheck} title={t('admin.emptyQueue')} />}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function CaseCard({ item }: { item: ReportCase }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const n = (value: number) => formatNumber(value, locale);
  const deleted = item.target_state === 'deleted';
  const label = localized(locale, item.label_ar ?? '', item.label_en) || t('admin.untitled');
  // The take-down the target can still be given, as the website's case offers it.
  const actionable =
    !deleted &&
    (item.target_type === 'job'
      ? item.target_state === 'active' || item.target_state === 'pending_review'
      : item.target_type === 'company'
        ? item.target_state === 'listed'
        : item.target_state !== 'restricted');
  const reasons = formatList([...new Set(item.reasons)].map((reason) => t(`reportReason.${reason}`)), locale);

  const open = () => {
    if (item.target_type === 'job') router.push({ pathname: '/admin/jobs/[id]', params: { id: item.target_id } });
    else openOnWebsite(item.target_type === 'company' ? `/admin/companies/${item.target_id}` : `/admin/agents/${item.target_id}`);
  };

  const lever = (decision: Omit<Decision, 'lever'> & { status: 'investigating' | 'resolved' | 'dismissed'; takeAction?: boolean }) => {
    const { status, takeAction, ...words } = decision;
    openDecision({ ...words, lever: { do: 'reports', targetType: item.target_type, targetId: item.target_id, status, takeAction } });
  };

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
        {deleted ? (
          <Text weight="semibold">{label}</Text>
        ) : (
          <Pressable accessibilityRole="link" onPress={open}>
            <Text weight="semibold" tone="primary">
              {label}
            </Text>
          </Pressable>
        )}
        {item.target_type === 'job' && item.company_name_ar ? (
          <Text variant="small" tone="mutedForeground">
            {localized(locale, item.company_name_ar, item.company_name_en)}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        <Badge
          variant={item.max_severity >= 3 ? 'destructive' : item.max_severity === 2 ? 'warning' : 'default'}
          label={t(`admin.severity.${item.max_severity}`)}
        />
        <Badge variant={item.reporters > 1 ? 'destructive' : 'outline'} label={t('admin.reportersCount', { count: n(item.reporters) })} />
        {item.system_flags ? <Badge variant="warning" label={t('admin.systemFlagShort')} /> : null}
        {deleted ? <Badge variant="outline" label={t('admin.stateDeleted')} /> : null}
        {item.target_state === 'suspended' || item.target_state === 'company_suspended' ? (
          <Badge variant="destructive" label={t('admin.suspended')} />
        ) : null}
        {item.target_state === 'restricted' ? <Badge variant="destructive" label={t('admin.restricted')} /> : null}
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

      {item.details.slice(0, SHOWN_REPORTS).map((report) => (
        <View key={report.id} style={{ gap: 2, padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
          <Text variant="small" weight="medium">
            {t(`reportReason.${report.reason}`)}
          </Text>
          {report.detail ? (
            <Text variant="small" tone="mutedForeground">
              {report.detail}
            </Text>
          ) : null}
          <Text variant="caption" tone="mutedForeground">
            {`${
              report.source === 'system'
                ? t('admin.systemFlag')
                : report.reporter_name
                  ? t('app.admin.reportedBy', { name: report.reporter_name })
                  : t('admin.reporterGone')
            } · ${formatDate(report.created_at, locale)}`}
          </Text>
        </View>
      ))}
      {item.reports > SHOWN_REPORTS ? (
        <Text variant="caption" tone="mutedForeground">
          {t.markup('app.admin.reportCount', { count: item.reports, ...markupTags })}
        </Text>
      ) : null}

      {deleted ? (
        <View style={{ gap: space[2] }}>
          <Text variant="small" tone="mutedForeground">
            {t('app.admin.deletedTarget')}
          </Text>
          <Button
            label={t('app.admin.onWebsite')}
            variant="outline"
            size="sm"
            icon={<ExternalLink size={16} color={colors.foreground} />}
            onPress={() => openOnWebsite('/admin/reports')}
          />
        </View>
      ) : (
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
      )}
    </Card>
  );
}
