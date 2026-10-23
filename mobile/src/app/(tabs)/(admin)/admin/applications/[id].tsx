import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate, formatNumber } from '@/lib/format';
import { displayJobStatus } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import type { JobStatus } from '@/lib/supabase/database.types';
import { AdminGate, ApprovalBadge, Fact, SectionTitle, useRoleLabel } from '~/components/admin/kit';
import { Record } from '~/components/admin/record';
import { Badge } from '~/components/ui/badge';
import { Card } from '~/components/ui/card';
import { ForwardChevron } from '~/components/ui/icons';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { UUID } from '~/features/admin/agents';
import { useApplicationFile, type ApplicationFile } from '~/features/admin/applications';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/** The website's JobStatusBadge: classified by the date, as the board does (`active` past its window reads expired). */
const JOB_VARIANT: Record<JobStatus, 'outline' | 'warning' | 'success' | 'default' | 'destructive'> = {
  draft: 'outline',
  pending_review: 'warning',
  active: 'success',
  expired: 'default',
  closed: 'default',
  rejected: 'destructive',
};

/**
 * One application, read-only — the website's /admin/applications/<id>.
 * Enough to settle "what happened to my application": the listing and the
 * company, the candidate, when it was sent and opened, and every move it made
 * with who made it. Not the CV: nothing about a dispute over process needs
 * the document, and the website serves it only to the two parties. The
 * employer's private notes are counted, not shown. No lever moves an
 * application from here.
 */
export default function AdminApplicationScreen() {
  const t = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: t('admin.application') }} />
      <AdminGate>
        <Application id={typeof id === 'string' && UUID.test(id) ? id : undefined} />
      </AdminGate>
    </>
  );
}

function Application({ id }: { id: string | undefined }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const file = useApplicationFile(id);
  const pull = usePullRefresh(() => file.refetch());

  if (!id) return <NotFoundState />;
  if (file.isPending) return <LoadingState />;
  if (file.isError && !file.data) return <ErrorState error={file.error} onRetry={() => file.refetch()} />;
  const application = file.data;
  if (!application) return <NotFoundState />;

  const listing = application.job ? localized(locale, application.job.title_ar, application.job.title_en) : null;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[5] }}
    >
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
          <Text variant="title" weight="bold" accessibilityRole="header" style={{ flex: 1 }}>
            {application.candidate?.full_name ?? t('admin.applications')}
          </Text>
          <Badge variant="outline" label={t(`applicationStatus.${application.status}`)} />
        </View>
        {listing ? <Text tone="mutedForeground">{listing}</Text> : null}
      </View>

      <View style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
        <Text variant="caption" tone="mutedForeground">
          {t('admin.applicationReadOnly')}
        </Text>
      </View>

      <Card style={{ gap: space[4] }}>
        <SectionTitle>{t('admin.application')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[3], columnGap: space[4] }}>
          <Fact label={t('admin.colStatus')}>{t(`applicationStatus.${application.status}`)}</Fact>
          <Fact label={t('admin.colSent')}>{formatDate(application.created_at, locale)}</Fact>
          <Fact label={t('admin.colOpened')}>
            {application.employer_viewed_at ? formatDate(application.employer_viewed_at, locale) : t('admin.notOpened')}
          </Fact>
          <Fact label={t('admin.experience')}>
            {application.experience_band ? t(`experienceBand.${application.experience_band}`) : '—'}
          </Fact>
          {/* How many the employer kept to themselves, never what they say. */}
          <Fact label={t('admin.employerNotes')}>{formatNumber(application.employer_notes, locale)}</Fact>
          <Fact label={t('admin.accountId')}>
            {/* The id as written, left to right, and copyable. */}
            <Text variant="caption" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }}>
              {application.id}
            </Text>
          </Fact>
        </View>
        {application.decision_note ? (
          <Fact label={t('admin.decisionNote')}>
            <Text variant="small" selectable>
              {application.decision_note}
            </Text>
          </Fact>
        ) : null}
        {application.note ? (
          <Fact label={t('admin.coverNote')}>
            <Text variant="small" tone="mutedForeground" selectable>
              {application.note}
            </Text>
          </Fact>
        ) : null}
      </Card>

      <Parties application={application} />

      <Card style={{ gap: space[3] }}>
        <SectionTitle>{t('admin.applicationHistory')}</SectionTitle>
        {application.history.length === 0 ? (
          <Text variant="small" tone="mutedForeground">
            {t('admin.trailEmpty')}
          </Text>
        ) : (
          application.history.map((event) => <Move key={event.id} event={event} />)
        )}
      </Card>

      <Record targetType="application" targetId={application.id} />
    </ScrollView>
  );
}

/** A row that opens another screen of the console — or, for a company, its page in the website's console until the app has one. */
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

/** Who is on each side: the candidate (→ their account), the listing (→ its review) and the company. */
function Parties({ application }: { application: ApplicationFile }) {
  const t = useTranslations();
  const locale = useLocale();
  const { candidate, job } = application;
  const company = job?.company ?? null;
  return (
    <Card style={{ gap: space[2] }}>
      <SectionTitle>{t('admin.parties')}</SectionTitle>
      {candidate ? (
        <LinkRow label={candidate.full_name} onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: candidate.id } })}>
          <Text weight="medium" tone="primary">
            {candidate.full_name}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <ApprovalBadge status={candidate.approval_status} />
          </View>
        </LinkRow>
      ) : null}
      {job ? (
        <LinkRow
          label={localized(locale, job.title_ar, job.title_en)}
          onPress={() => router.push({ pathname: '/admin/jobs/[id]', params: { id: job.id } })}
        >
          <Text weight="medium" tone="primary">
            {localized(locale, job.title_ar, job.title_en)}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <Badge variant={JOB_VARIANT[displayJobStatus(job)]} label={t(`jobStatus.${displayJobStatus(job)}`)} />
          </View>
        </LinkRow>
      ) : null}
      {company ? (
        <LinkRow label={localized(locale, company.name_ar, company.name_en)} onPress={() => router.push({ pathname: '/admin/companies/[id]', params: { id: company.id } })}>
          <Text weight="medium" tone="primary">
            {localized(locale, company.name_ar, company.name_en)}
          </Text>
        </LinkRow>
      ) : null}
    </Card>
  );
}

/** One move the application made: from where to where, by whom, and when — the website's own line. */
function Move({ event }: { event: ApplicationFile['history'][number] }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const roleLabel = useRoleLabel();
  return (
    <View style={{ gap: 2, paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.border }}>
      <Text variant="small">
        {event.from_status ? `${t(`applicationStatus.${event.from_status}`)} ← ` : ''}
        <Text variant="small" weight="medium">
          {t(`applicationStatus.${event.to_status}`)}
        </Text>
      </Text>
      <Text variant="caption" tone="mutedForeground">
        {`${event.actor ? `${event.actor.full_name} (${roleLabel(event.actor.role)})` : t('admin.actorUnknown')} · ${formatDate(event.created_at, locale)}`}
      </Text>
    </View>
  );
}
