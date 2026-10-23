import { View } from 'react-native';
import { Stack } from 'expo-router';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import { isRetryable } from '@/lib/email/retryable';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { EmailDeadLetterRow, JobRunRow, JobRunStatus, OutboxOverview, ScheduledJobOverviewRow } from '@/lib/supabase/database.types';
import { openDecision } from '~/components/admin/decision-sheet';
import { AdminGate, Fact, SectionTitle } from '~/components/admin/kit';
import { MailOffBanner } from '~/components/admin/mail-banner';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { ListRestart } from '~/components/ui/lucide';
import { ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useOperations } from '~/features/admin/ops';
import { useTabList } from '~/features/tab-bar';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The background work, in one place — the website's /admin/operations. It
 * answers the three questions an admin actually asks: are the scheduled
 * tasks running, is mail stuck, and which messages has the system stopped
 * trying to send. The one lever is Retry on a dead letter, offered only where
 * a requeue can send something: a template the sweeper cannot rebuild comes
 * straight back as a dead letter having sent nothing.
 */
export default function AdminOperationsScreen() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.operations') }} />
      <AdminGate>
        <Work />
      </AdminGate>
    </>
  );
}

/** The website's badge colour for each run state. */
const VARIANT: Record<JobRunStatus, 'default' | 'primary' | 'success' | 'destructive'> = {
  running: 'primary',
  succeeded: 'success',
  failed: 'destructive',
  skipped: 'default',
};

/**
 * One list, the dead letters its rows — the rows with the lever — with the
 * scheduled tasks and the outbox above them and the runs below, in the
 * website's order: are the tasks running, is mail stuck, which messages has
 * the system stopped trying to send, and what ran lately.
 */
function Work() {
  const t = useTranslations();
  const work = useOperations();
  const pull = usePullRefresh(() => work.refetch());
  const list = useTabList<FlashListRef<EmailDeadLetterRow>>();

  if (work.isPending) return <LoadingState />;
  if (work.isError && !work.data) return <ErrorState error={work.error} onRetry={() => work.refetch()} />;
  const { jobs, outbox, dead, runs } = work.data;

  return (
    <FlashList
      {...list}
      data={dead}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <DeadLetter key={item.id} row={item} />}
      ItemSeparatorComponent={Separator}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
      ListHeaderComponent={
        <View style={{ gap: space[3], marginBottom: space[3] }}>
          <MailOffBanner />
          <Text variant="small" tone="mutedForeground">
            {t('admin.operationsLede')}
          </Text>
          <Heading title={t('admin.opsJobsTitle')} />
          {jobs.map((entry) => (
            <JobRow key={entry.job} job={entry.job} row={entry.row} />
          ))}
          <Heading title={t('admin.opsOutboxTitle')} />
          <Outbox outbox={outbox} />
          <Heading title={t('admin.opsDeadTitle')} lede={t('admin.opsDeadLede')} />
        </View>
      }
      ListEmptyComponent={<Empty text={t('admin.opsDeadEmpty')} />}
      ListFooterComponent={
        <View style={{ gap: space[3], marginTop: space[3] }}>
          <Heading title={t('admin.opsRunsTitle')} />
          {runs.length ? runs.map((run) => <Run key={run.id} row={run} />) : <Empty text={t('admin.opsRunsEmpty')} />}
        </View>
      }
      {...pull}
    />
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

function Heading({ title, lede }: { title: string; lede?: string }) {
  return (
    <View style={{ gap: 2, paddingTop: space[3] }}>
      <SectionTitle>{title}</SectionTitle>
      {lede ? (
        <Text variant="caption" tone="mutedForeground" style={{ paddingHorizontal: space[1] }}>
          {lede}
        </Text>
      ) : null}
    </View>
  );
}

/** Nothing of this kind — said only once the read said so. */
function Empty({ text }: { text: string }) {
  return (
    <Card>
      <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
        {text}
      </Text>
    </Card>
  );
}

/** A task's name as it is written in vercel.json: a code word, left to right. */
function Code({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: space[2], paddingVertical: 1, borderRadius: 6, backgroundColor: colors.muted }}>
      <Text variant="caption" weight="medium" style={{ writingDirection: 'ltr' }}>
        {children}
      </Text>
    </View>
  );
}

/** Seconds to a tenth, as the website writes a duration. */
function useSeconds() {
  const t = useTranslations();
  const locale = useLocale();
  return (ms: number | null) => (ms === null ? '—' : t('admin.opsSeconds', { value: formatNumber(Math.round(ms / 100) / 10, locale) }));
}

/** One scheduled task: its last run and how it went, or that it has never run at all — the most important row this screen can show. */
function JobRow({ job, row }: { job: string; row: ScheduledJobOverviewRow | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const seconds = useSeconds();
  const failures = Number(row?.failures_7d ?? 0);
  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <View style={{ gap: 2 }}>
          <Code>{job}</Code>
          {row?.running ? (
            <Text variant="caption" tone="primary">
              {t('admin.opsRunningNow')}
            </Text>
          ) : null}
        </View>
        {row?.last_status ? (
          <Badge variant={VARIANT[row.last_status]} label={t(`admin.opsStatus.${row.last_status}`)} />
        ) : (
          <Badge variant="warning" label={t('admin.opsNeverRun')} />
        )}
      </View>
      {row?.last_error ? (
        <Text variant="caption" tone="destructive" numberOfLines={3}>
          {row.last_error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[2], columnGap: space[4] }}>
        <Fact label={t('admin.opsLastRun')}>{row?.last_started_at ? formatDateTime(row.last_started_at, locale) : '—'}</Fact>
        <Fact label={t('admin.opsDuration')}>{seconds(row?.last_duration_ms ?? null)}</Fact>
        <Fact label={t('admin.opsLastSuccess')}>{row?.last_success_at ? formatDateTime(row.last_success_at, locale) : '—'}</Fact>
        <Fact label={t('admin.opsFailures')}>
          <Text variant="small" weight={failures > 0 ? 'semibold' : 'regular'} tone={failures > 0 ? 'destructive' : 'foreground'}>
            {formatNumber(failures, locale)}
          </Text>
        </Fact>
      </View>
    </Card>
  );
}

/** The retry queue in four figures (outbox_overview): what is due, in flight, waiting, and given up on. */
function Outbox({ outbox }: { outbox: OutboxOverview | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const n = (value: number) => formatNumber(value, locale);
  const figures = outbox
    ? [
        { label: t('admin.opsDue'), value: Number(outbox.due) },
        { label: t('admin.opsInFlight'), value: Number(outbox.in_flight) },
        { label: t('admin.opsWaiting'), value: Number(outbox.waiting) },
        { label: t('admin.opsDead'), value: Number(outbox.dead) },
      ]
    : [];
  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[3], columnGap: space[4] }}>
        {figures.map((figure) => (
          <Fact key={figure.label} label={figure.label}>
            <Text variant="title" weight="bold" accessibilityLabel={`${figure.label}: ${n(figure.value)}`}>
              {n(figure.value)}
            </Text>
          </Fact>
        ))}
      </View>
      {outbox?.oldest_due_at ? (
        <Text variant="caption" tone="mutedForeground">
          {t('admin.opsOldestDue', { when: formatDateTime(outbox.oldest_due_at, locale) })}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * A message the system stopped trying to send, and — where a requeue can
 * send something — Retry: the row gets one more attempt on the next sweep
 * (requeueEmail; nothing is sent from the tap). Hidden where the website
 * hides it: a template the sweeper cannot rebuild, or no entity to rebuild
 * it from, so a button there would report a success that never happens.
 */
function DeadLetter({ row }: { row: EmailDeadLetterRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const retryable = isRetryable(row.template) && Boolean(row.entity_id);
  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="small" weight="semibold" selectable numberOfLines={1} style={{ writingDirection: 'ltr' }}>
          {row.recipient}
        </Text>
        <Text variant="caption" tone="mutedForeground">
          {formatDateTime(row.created_at, locale)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[2], columnGap: space[4] }}>
        <Fact label={t('admin.emailTemplate')}>
          <View style={{ alignItems: 'flex-start', gap: 2 }}>
            <Code>{row.template}</Code>
            {row.entity_type ? (
              <Text variant="caption" tone="mutedForeground" style={{ writingDirection: 'ltr' }}>
                {row.entity_type}
              </Text>
            ) : null}
          </View>
        </Fact>
        <Fact label={t('admin.opsAttempts')}>{`×${formatNumber(row.attempts, locale)}`}</Fact>
        <Fact label={t('admin.opsGaveUpAt')}>{formatDateTime(row.gave_up_at, locale)}</Fact>
      </View>
      {row.error ? (
        <Text variant="caption" tone="destructive" numberOfLines={3}>
          {`${t('admin.emailError')}: ${row.error}`}
        </Text>
      ) : null}
      {retryable ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={t('admin.opsRetry')}
            accessibilityLabel={`${t('admin.opsRetry')}: ${row.recipient}`}
            variant="outline"
            size="sm"
            icon={<ListRestart size={16} color={colors.foreground} />}
            onPress={() =>
              openDecision({
                lever: { do: 'requeue', emailId: row.id },
                title: t('admin.opsRetry'),
                body: t('app.admin.ops.retryBody'),
                confirmLabel: t('admin.opsRetry'),
                reason: 'none',
              })
            }
          />
        </View>
      ) : null}
    </Card>
  );
}

/** Counts a run recorded, as one line of identifiers — `sent 3 · failed 1`. */
function statsLine(stats: JobRunRow['stats'] | null): string {
  if (!stats) return '';
  return Object.entries(stats)
    .filter(([key]) => key !== 'ms')
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(' · ');
}

/** One run of a task: when, how long, and what it counted — or why it failed. */
function Run({ row }: { row: JobRunRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const seconds = useSeconds();
  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <Code>{row.job}</Code>
        <Badge variant={VARIANT[row.status]} label={t(`admin.opsStatus.${row.status}`)} />
      </View>
      <Text variant="caption" tone="mutedForeground">
        {`${t('admin.opsStarted')}: ${formatDateTime(row.started_at, locale)} · ${t('admin.opsDuration')}: ${seconds(row.duration_ms)}`}
      </Text>
      {row.error ? (
        <Text variant="caption" tone="destructive" numberOfLines={3}>
          {row.error}
        </Text>
      ) : (
        <Text variant="caption" tone="mutedForeground" numberOfLines={2} style={{ writingDirection: 'ltr' }}>
          {`${t('admin.opsStats')}: ${statsLine(row.stats) || '—'}`}
        </Text>
      )}
    </Card>
  );
}
