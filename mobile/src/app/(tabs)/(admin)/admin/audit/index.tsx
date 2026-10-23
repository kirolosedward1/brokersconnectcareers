import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import type { AdminAuditRow } from '@/lib/supabase/database.types';
import { AdminGate, auditLabel } from '~/components/admin/kit';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { History } from '~/components/ui/lucide';
import { PageFooter } from '~/components/ui/page-footer';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  AUDIT_TYPES,
  auditActorOf,
  auditChange,
  auditTargetOf,
  auditTypeOf,
  flattenAudit,
  useAuditLog,
  type AuditType,
} from '~/features/admin/audit';
import { consolePath } from '~/features/admin/search';
import { useTabList } from '~/features/tab-bar';
import { useNextPage } from '~/lib/use-next-page';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';

/**
 * The audit log — the website's /admin/audit: every decision, newest first,
 * and nothing that can be edited. Filtered by the kind of thing decided on,
 * or to the changes made directly through the API rather than a lever
 * (`direct`, each worth a second look), to one admin's decisions, or to the
 * decisions about one thing. Each entry opens what it was about, and names
 * who decided — a tap on the name shows that admin's decisions alone.
 */
export default function AdminAuditScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.auditLog') }} />
      <AdminGate>
        <Log />
      </AdminGate>
    </>
  );
}

function useTypeLabels(): Record<AuditType, string> {
  const t = useTranslations();
  return {
    all: t('admin.filterAll'),
    user: t('admin.kind.user'),
    company: t('admin.kind.company'),
    job: t('admin.kind.job'),
    agent: t('admin.kind.agent'),
    application: t('admin.kind.application'),
    taxonomy: t('admin.taxonomy'),
    direct: t('admin.viaDirect'),
  };
}

function Log() {
  const t = useTranslations();
  // The filters a link carries, in the website's own terms (`?type=`, `?actor=`, `?target=` on /admin/audit).
  const params = useLocalSearchParams<{ type?: string; actor?: string; target?: string }>();
  const [type, setType] = useState<AuditType>(() => auditTypeOf(params.type));
  const [actor, setActor] = useState<string | undefined>(() => auditActorOf(params.actor));
  const [target, setTarget] = useState<string | undefined>(() => auditTargetOf(params.target));
  const log = useAuditLog({ type, actor, target });
  const nextPage = useNextPage(log);
  const pull = usePullRefresh(() => log.refetch());
  const list = useTabList<FlashListRef<AdminAuditRow>>();
  const rows = useMemo(() => flattenAudit(log.data?.pages), [log.data]);
  const labels = useTypeLabels();

  let body: ReactNode = null;
  if (log.isPending) body = <LoadingState />;
  // A log that could not be read is said so: never "no decisions yet", which is what an aal1 admin would be told.
  else if (log.isError && !log.data) body = <ErrorState error={log.error} onRetry={() => log.refetch()} />;

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <Text variant="small" tone="mutedForeground">
        {t('admin.auditLede')}
      </Text>
      {/* One type at a time: a radio group, as VoiceOver should say it. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('admin.reportTarget')}
        contentContainerStyle={{ gap: space[2] }}
      >
        {AUDIT_TYPES.map((option) => (
          <Chip key={option} radio label={labels[option]} selected={option === type} onPress={() => setType(option)} />
        ))}
      </ScrollView>
      {actor || target ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
          <View style={{ flex: 1, gap: 2 }}>
            {actor ? (
              <Text variant="small" tone="mutedForeground">
                {t('app.admin.audit.filteredActor')}
              </Text>
            ) : null}
            {target ? (
              <Text variant="small" tone="mutedForeground">
                {t('app.admin.audit.filteredTarget')}
              </Text>
            ) : null}
          </View>
          <Button
            label={t('admin.clearFilter')}
            variant="outline"
            size="sm"
            onPress={() => {
              setActor(undefined);
              setTarget(undefined);
            }}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <FlashList
      {...list}
      data={body ? [] : rows}
      keyExtractor={(row) => String(row.id)}
      renderItem={({ item }) => <Entry key={item.id} row={item} onActor={setActor} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={header}
      ListEmptyComponent={body ?? <EmptyState icon={History} title={t('admin.trailEmpty')} />}
      ListFooterComponent={<PageFooter query={log} />}
      onEndReached={nextPage}
      onEndReachedThreshold={0.5}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

/** One decision: what was done, to what (a tap opens it), why, by whom (a tap shows their decisions) and when. */
function Entry({ row, onActor }: { row: AdminAuditRow; onActor: (actor: string) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const targetLabel = row.target_label ?? row.target_id;
  const path = consolePath(row.target_type, row.target_id);
  const change = auditChange(row);
  const actorName = row.actor_name ?? t('admin.unknownActor');

  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        <Text weight="semibold" style={{ flexShrink: 1 }}>
          {auditLabel(t, row.action)}
        </Text>
        {row.via === 'direct' ? <Badge variant="warning" label={t('admin.viaDirect')} /> : null}
      </View>

      {path ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={targetLabel}
          accessibilityHint={t('app.admin.audit.targetHint')}
          onPress={() => router.navigate(path as Href)}
          hitSlop={4}
          style={({ pressed }) => ({ minHeight: hitTarget - 12, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
        >
          <Text variant="small" weight="medium" tone="primary">
            {targetLabel}
          </Text>
        </Pressable>
      ) : (
        <Text variant="small" tone="mutedForeground">
          {targetLabel}
        </Text>
      )}
      {change ? (
        // The move as written (`active → closed`), left to right whatever the language around it.
        <Text variant="caption" tone="mutedForeground" style={{ writingDirection: 'ltr' }}>
          {change}
        </Text>
      ) : null}
      {row.reason ? <Text variant="small" tone="mutedForeground">{`«${row.reason}»`}</Text> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] }}>
        {row.actor_id ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actorName}
            accessibilityHint={t('app.admin.audit.actorHint')}
            onPress={() => onActor(row.actor_id as string)}
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text variant="caption" weight="medium" style={{ color: colors.primary }}>
              {actorName}
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="mutedForeground">
            {actorName}
          </Text>
        )}
        <Text variant="caption" tone="mutedForeground">{` · ${formatDateTime(row.created_at, locale)}`}</Text>
      </View>
    </Card>
  );
}
