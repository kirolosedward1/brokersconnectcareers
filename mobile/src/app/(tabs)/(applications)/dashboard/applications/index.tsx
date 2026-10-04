import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Building2, Eye, MapPin, UserRound } from '~/components/ui/lucide';
import { formatDate } from '@/lib/format';
import { displayJobStatus } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { HeaderBell } from '~/components/notifications/header-bell';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import {
  canWithdraw,
  STATUS_VARIANT,
  useMyApplications,
  useWithdrawApplication,
  type CandidateApplication,
} from '~/features/applications/queries';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

/**
 * The candidate's applications — the website's /dashboard/applications: every
 * role applied to and where it stands, what the company said when it said
 * anything, whether anybody has opened it yet, and what became of the listing.
 */
export default function ApplicationsScreen() {
  const t = useTranslations();
  const { colors, shadow } = useTheme();
  const { session } = useSession();
  const applications = useMyApplications();
  // A push about a move reads the list again; the spinner is the pull's alone.
  const pull = usePullRefresh(() => applications.refetch());

  let body: React.ReactNode;
  if (!session) {
    body = (
      <EmptyState
        icon={UserRound}
        title={t('app.account.signedOutTitle')}
        action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
      />
    );
  } else if (applications.isPending) {
    body = <LoadingState />;
  } else if (applications.isError && !applications.data) {
    // Never "you have not applied" for a read that failed.
    body = <ErrorState error={applications.error} onRetry={() => applications.refetch()} />;
  } else {
    const rows = applications.data.filter((application) => application.job);
    body = (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
        refreshControl={
          <RefreshControl {...pull} tintColor={colors.primary} />
        }
      >
        <Text tone="mutedForeground">{t('dashboard.applicationsLede')}</Text>

        {rows.length === 0 ? (
          <View
            style={{
              alignItems: 'center',
              gap: space[3],
              paddingVertical: space[8],
              paddingHorizontal: space[6],
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderStyle: 'dashed',
              borderColor: colors.border,
            }}
          >
            <Text weight="medium" style={{ textAlign: 'center' }}>
              {t('dashboard.emptyApplications')}
            </Text>
            <Button label={t('dashboard.emptyApplicationsCta')} onPress={() => router.navigate('/jobs')} />
          </View>
        ) : (
          // One surface, ruled rows — the website's layout, not a card per application.
          <View
            style={{
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.border,
              boxShadow: shadow.card,
              backgroundColor: colors.card,
              overflow: 'hidden',
            }}
          >
            {rows.map((application, index) => (
              <ApplicationRow key={application.id} application={application} first={index === 0} />
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{ title: t('dashboard.applications'), headerLargeTitleEnabled: true, headerRight: () => <HeaderBell /> }}
      />
      {body}
    </>
  );
}

function ApplicationRow({ application, first }: { application: CandidateApplication; first: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const withdraw = useWithdrawApplication();
  const [failed, setFailed] = useState(false);

  const job = application.job;
  if (!job) return null;

  const title = localized(locale, job.title_ar, job.title_en);
  const shown = displayJobStatus(job);

  const confirmWithdraw = () => {
    Alert.alert(t('app.applications.withdrawTitle', { title }), t('app.applications.withdrawBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('dashboard.withdraw'),
        style: 'destructive',
        onPress: () => {
          setFailed(false);
          withdraw.mutate(application.id, { onError: () => setFailed(true) });
        },
      },
    ]);
  };

  return (
    <View
      style={{
        gap: space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
          >
            <Text weight="semibold">{title}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space[3], rowGap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Building2 size={14} color={colors.mutedForeground} />
              <Text variant="small" tone="mutedForeground">
                {localized(locale, job.company.name_ar, job.company.name_en)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MapPin size={14} color={colors.mutedForeground} />
              <Text variant="small" tone="mutedForeground">
                {localized(locale, job.district.name_ar, job.district.name_en)}
              </Text>
            </View>
          </View>
        </View>
        <Badge variant={STATUS_VARIANT[application.status]} label={t(`applicationStatus.${application.status}`)} />
      </View>

      {/* That a person at the company has had it on screen — only while the
          outcome is open; once the status moves, the status is the news. */}
      {application.status === 'new' && application.employer_viewed_at ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <Eye size={14} color={colors.success} />
          <Text variant="caption" weight="medium" tone="success">
            {t('dashboard.applicationOpened')}
          </Text>
        </View>
      ) : null}

      {/* What happened to the listing, by its date as well as its label. */}
      {shown !== 'active' ? (
        <Aside color={colors.border}>
          <Text variant="caption" tone="mutedForeground">
            {shown === 'closed' || shown === 'expired'
              ? t('dashboard.applicationListingClosed')
              : t('dashboard.applicationListingOffBoard')}
          </Text>
        </Aside>
      ) : null}

      {/* The reason, when the company gave one. */}
      {application.decision_note ? (
        <Aside color={colors.primary}>
          <Text variant="caption" weight="medium" tone="mutedForeground">
            {t('dashboard.decisionFromCompany')}
          </Text>
          <Text variant="small">{application.decision_note}</Text>
        </Aside>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
        <Text variant="caption" tone="mutedForeground">
          {t('dashboard.appliedOn', { date: formatDate(application.created_at, locale) })}
        </Text>
        {canWithdraw(application.status) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: withdraw.isPending }}
            disabled={withdraw.isPending}
            onPress={confirmWithdraw}
            hitSlop={8}
            style={{ minHeight: 36, justifyContent: 'center', opacity: withdraw.isPending ? 0.5 : 1 }}
          >
            {/* Red, because withdrawing is the one that cannot be taken back. */}
            <Text variant="small" weight="medium" tone="destructive">
              {t('dashboard.withdraw')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {failed ? (
        <Text variant="caption" tone="destructive" accessibilityRole="alert">
          {t('common.errorBody')}
        </Text>
      ) : null}
    </View>
  );
}

/** A sentence about the row it sits in: a rule down its leading edge, no box. */
function Aside({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <View style={{ borderStartWidth: 2, borderStartColor: color, paddingStart: space[3], gap: 2 }}>{children}</View>
  );
}
