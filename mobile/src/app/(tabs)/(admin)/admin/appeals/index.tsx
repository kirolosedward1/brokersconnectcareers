import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { localized } from '@/lib/locale';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Gavel, ShieldCheck, Undo2 } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { Segmented } from '~/components/ui/segmented';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { flattenAppeals, readAppealView, subjectPath, useAppeals, type Appeal, type AppealView } from '~/features/admin/appeals';
import { useTabList } from '~/features/tab-bar';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/** The appellant's note may run to a thousand characters (the action's cap), twice a reason's. */
const NOTE_MAX = 1000;

/**
 * Appeals — the website's /admin/appeals: somebody says a decision about
 * them was wrong. Waiting ones oldest first, because the person waiting
 * longest has been without their listing, company or account longest. Each
 * shows the decision as it stood when appealed — the reason the moderator
 * gave at the time — beside what the person says was wrong with it, so the
 * answer is read against both.
 *
 * Reversing goes through the same lever a moderator would pull by hand (the
 * post cap, the credit and a company's suspension still apply to a restored
 * listing), in one transaction with the answer; letting the decision stand
 * needs a reason, because that reason is what the person is sent.
 */
export default function AdminAppealsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.appeals') }} />
      <AdminGate>
        <Appeals />
      </AdminGate>
    </>
  );
}

function Appeals() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ status?: string }>();
  const [view, setView] = useState<AppealView>(() => readAppealView(params.status));
  const appeals = useAppeals(view);
  const nextPage = useNextPage(appeals);
  const pull = usePullRefresh(() => appeals.refetch());
  const list = useTabList<FlashListRef<Appeal>>();
  const rows = useMemo(() => flattenAppeals(appeals.data?.pages), [appeals.data]);

  let body: ReactNode = null;
  if (appeals.isPending) body = <LoadingState />;
  else if (appeals.isError && !appeals.data) body = <ErrorState error={appeals.error} onRetry={() => appeals.refetch()} />;

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.appealsLede')}
      </Text>
      <Segmented
        label={t('admin.colStatus')}
        options={[
          { value: 'open', label: t('admin.appealView.open') },
          { value: 'decided', label: t('admin.appealView.decided') },
        ]}
        value={view}
        onChange={setView}
      />
    </View>
  );

  return (
    <FlashList
      {...list}
      data={body ? [] : rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <AppealCard key={item.id} row={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={header}
      ListEmptyComponent={body ?? <EmptyState icon={ShieldCheck} title={t('admin.emptyQueue')} />}
      ListFooterComponent={<PageFooter query={appeals} />}
      onEndReached={nextPage}
      onEndReachedThreshold={0.5}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function AppealCard({ row }: { row: Appeal }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const label = localized(locale, row.decision_snapshot.label_ar ?? '', row.decision_snapshot.label_en ?? null) || t('admin.untitled');
  const snapshot = row.decision_snapshot;

  // The decision appealed, as the website words it from the snapshot.
  let state = '';
  switch (row.subject_type) {
    case 'job':
      state = snapshot.status ? t(`jobStatus.${snapshot.status}` as never) : '';
      break;
    case 'company':
      state = t('admin.suspended');
      break;
    case 'agent':
      state = t('admin.restricted');
      break;
    case 'account':
      state = snapshot.status ? t(`admin.approval.${snapshot.status}` as never) : '';
      break;
  }

  const decide = (overturn: boolean) =>
    openDecision({
      lever: { do: 'appeal', appealId: row.id, overturn },
      title: overturn ? t('admin.appealOverturn') : t('admin.appealUphold'),
      body: overturn ? t(`admin.appealOverturnBody.${row.subject_type}`) : t('admin.appealUpholdBody'),
      confirmLabel: overturn ? t('admin.appealOverturn') : t('admin.appealUphold'),
      // The note goes to the person: optional with a reversal, owed with a refusal.
      reason: overturn ? 'optional' : 'required',
      reasonLabel: t('admin.appealNoteToPerson'),
      reasonMax: NOTE_MAX,
    });

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="caption" tone="mutedForeground">
          {t(`admin.appealSubject.${row.subject_type}`)}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.navigate(subjectPath(row.subject_type, row.subject_id) as Href)}
          style={{ minHeight: hitTarget, justifyContent: 'center' }}
        >
          <Text weight="semibold" tone="primary">
            {label}
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        {row.status === 'open' ? (
          <Badge variant="warning" label={t('admin.appealView.open')} />
        ) : (
          <Badge variant={row.status === 'overturned' ? 'success' : 'outline'} label={t(`admin.appealOutcome.${row.status}`)} />
        )}
        <Text variant="caption" tone="mutedForeground">
          {t('app.admin.appeals.filedOn', { date: formatDate(row.created_at, locale) })}
        </Text>
      </View>

      <View style={{ gap: 2, paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.border }}>
        <Text variant="caption" tone="mutedForeground">
          {t('admin.appealDecision', { state })}
        </Text>
        {snapshot.note ? (
          <Text variant="small" tone="mutedForeground">
            {`«${snapshot.note}»`}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: space[1], padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
        {row.appellant ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: (row.appellant as { id: string }).id } })}
            style={{ minHeight: hitTarget, justifyContent: 'center' }}
          >
            <Text variant="caption" tone="primary">
              {row.appellant.full_name}
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="mutedForeground">
            {t('admin.reporterGone')}
          </Text>
        )}
        <Text variant="small" selectable>
          {row.message}
        </Text>
      </View>

      {row.status === 'open' ? (
        <View style={{ gap: space[2] }}>
          <Button
            label={t('admin.appealOverturn')}
            accessibilityLabel={`${t('admin.appealOverturn')}: ${label}`}
            size="sm"
            icon={<Undo2 size={16} color={colors.primaryForeground} />}
            onPress={() => decide(true)}
          />
          <Button
            label={t('admin.appealUphold')}
            accessibilityLabel={`${t('admin.appealUphold')}: ${label}`}
            variant="outline"
            size="sm"
            icon={<Gavel size={16} color={colors.foreground} />}
            onPress={() => decide(false)}
          />
        </View>
      ) : (
        <View style={{ gap: 2 }}>
          <Text variant="caption" tone="mutedForeground">
            {t('admin.appealDecidedBy', {
              name: row.decider?.full_name ?? t('admin.unknownActor'),
              date: row.decided_at ? formatDate(row.decided_at, locale) : '',
            })}
          </Text>
          {row.decision_note ? <Text variant="small">{`«${row.decision_note}»`}</Text> : null}
        </View>
      )}
    </Card>
  );
}
