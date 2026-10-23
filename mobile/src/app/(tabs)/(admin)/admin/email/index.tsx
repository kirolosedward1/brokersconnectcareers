import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { EmailActivityRow, EmailStatus } from '@/lib/supabase/database.types';
import { AdminGate, Fact } from '~/components/admin/kit';
import { MailOffBanner } from '~/components/admin/mail-banner';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { Mail } from '~/components/ui/lucide';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { EMAIL_FILTERS, useEmailActivity, useEmailSummary } from '~/features/admin/ops';
import { useTabList } from '~/features/tab-bar';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * What happened to the emails — the website's /admin/email, built for one
 * question, "the email never reached me", which server logs cannot answer
 * after the fact: who it went to, which template, what it was about, and
 * the two moments that mean different things (sent: the provider accepted
 * it; delivered: the receiving server did). The one place in the console a
 * recipient's address is shown, as on the website; never the message body.
 */
export default function AdminEmailScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.emailActivity') }} />
      <AdminGate>
        <Activity />
      </AdminGate>
    </>
  );
}

/** The chip a website link names (`/admin/email?status=failed`), or every message. */
function statusFor(status: string | undefined): EmailStatus | null {
  return status && status !== 'all' && (EMAIL_FILTERS as readonly string[]).includes(status) ? (status as EmailStatus) : null;
}

/** The website's badge colour for each state. */
const VARIANT: Record<EmailStatus, 'default' | 'outline' | 'primary' | 'success' | 'destructive'> = {
  queued: 'outline',
  sent: 'primary',
  delivered: 'success',
  bounced: 'destructive',
  complained: 'destructive',
  failed: 'destructive',
  suppressed: 'default',
  // Not a failure: by retry time there was nothing left to send.
  cancelled: 'default',
};

/** The outbox's own cap on attempts; rows from before the old sweeper recorded a released retry as 99. */
const MAX_ATTEMPTS = 5;

function Activity() {
  const t = useTranslations();
  const locale = useLocale();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState<EmailStatus | null>(() => statusFor(params.status));
  const summary = useEmailSummary();
  const activity = useEmailActivity(status);
  const pull = usePullRefresh(() => Promise.all([summary.refetch(), activity.refetch()]));
  const list = useTabList<FlashListRef<EmailActivityRow>>();
  const n = (value: number) => formatNumber(value, locale);

  let body: ReactNode = null;
  if (activity.isPending) body = <LoadingState />;
  else if (activity.isError && !activity.data) body = <ErrorState error={activity.error} onRetry={() => activity.refetch()} />;

  const header = (
    <View style={{ gap: space[3], marginBottom: space[4] }}>
      <MailOffBanner />
      <Text variant="small" tone="mutedForeground">
        {t('admin.emailActivityLede')}
      </Text>
      {/* One state at a time, each with its thirty-day count: a radio group, as VoiceOver should say it. */}
      {summary.isError && !summary.data ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('admin.emailStatusColumn')}
          contentContainerStyle={{ gap: space[2] }}
        >
          {EMAIL_FILTERS.map((option) => {
            const label = option === 'all' ? t('admin.emailAll') : t(`emailStatus.${option}`);
            const count = summary.data ? (option === 'all' ? summary.data.total : (summary.data.counts.get(option) ?? 0)) : null;
            const selected = option === 'all' ? status === null : status === option;
            return (
              <Chip
                key={option}
                radio
                label={count === null ? label : `${label} · ${n(count)}`}
                accessibilityLabel={count === null ? label : `${label}: ${n(count)}`}
                selected={selected}
                onPress={() => setStatus(option === 'all' ? null : option)}
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  return (
    <FlashList
      {...list}
      data={body ? [] : (activity.data ?? [])}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <EmailRow key={item.id} row={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={header}
      ListEmptyComponent={body ?? <EmptyState icon={Mail} title={t('admin.emailEmpty')} />}
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

/** One message: who, which, what became of it, and when. */
function EmailRow({ row }: { row: EmailActivityRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        <View style={{ flex: 1, gap: 2 }}>
          {/* An address as written: left to right whatever the language, and copyable. */}
          <Text variant="small" weight="semibold" selectable numberOfLines={1} style={{ writingDirection: 'ltr' }}>
            {row.recipient}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {formatDateTime(row.created_at, locale)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Badge variant={VARIANT[row.status]} label={t(`emailStatus.${row.status}`)} />
          {row.attempts > 1 ? (
            <Text variant="caption" tone="mutedForeground">
              {`×${formatNumber(Math.min(row.attempts, MAX_ATTEMPTS), locale)}`}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[2], columnGap: space[4] }}>
        <Fact label={t('admin.emailTemplate')}>
          <View style={{ alignItems: 'flex-start', gap: 2 }}>
            <View style={{ paddingHorizontal: space[2], paddingVertical: 1, borderRadius: 6, backgroundColor: colors.muted }}>
              <Text variant="caption" style={{ writingDirection: 'ltr' }}>
                {row.template}
              </Text>
            </View>
            {row.entity_type ? (
              <Text variant="caption" tone="mutedForeground" style={{ writingDirection: 'ltr' }}>
                {row.entity_type}
              </Text>
            ) : null}
          </View>
        </Fact>
        <Fact label={t('admin.emailSentAt')}>{row.sent_at ? formatDateTime(row.sent_at, locale) : '—'}</Fact>
        <Fact label={t('admin.emailDeliveredAt')}>{row.delivered_at ? formatDateTime(row.delivered_at, locale) : '—'}</Fact>
      </View>

      {row.error ? (
        <Text variant="caption" tone="destructive" numberOfLines={3}>
          {`${t('admin.emailError')}: ${row.error}`}
        </Text>
      ) : null}
    </Card>
  );
}
