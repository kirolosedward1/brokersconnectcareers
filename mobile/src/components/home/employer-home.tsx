import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { employerNextAction } from '@/lib/employer-next-action';
import { formatNumber } from '@/lib/format';
import { isSuspended } from '@/lib/permissions';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import { ConversionBars } from '~/components/dashboard/conversion-bars';
import { NextAction } from '~/components/dashboard/next-action';
import { StandingNotice } from '~/components/dashboard/standing-notice';
import { StatStrip } from '~/components/dashboard/stat-strip';
import { TrendBars } from '~/components/dashboard/trend-bars';
import { SetupChecklist } from '~/components/employer/setup-checklist';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { useEmployerSummary, useEmployerTrend } from '~/features/employer/overview';
import { routeInside } from '~/lib/links';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';

/**
 * An employer's Home — the website's /employer overview, in the order of what
 * needs attention rather than what is biggest: the one next action, where
 * the account and the company stand, and then the figures — the work first
 * (people waiting, listings about to lapse, listings in review), the
 * company's standing a step quieter. Before there is a listing the figures
 * stand down and the setup checklist says what is left; with one, the month
 * of applications and how each listing converts follow.
 *
 * A suspended account sees its standing and the appeal — which the website's
 * console, replacing every page, never shows it.
 */
export function EmployerHome({ profile, company }: { profile: ProfileRow | null; company: CompanyRow | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { actor } = useSession();
  const summary = useEmployerSummary();
  const trend = useEmployerTrend();

  const s = summary.data ?? null;
  const n = (value: number) => formatNumber(value, locale);
  const go = (href: string) => router.navigate(routeInside(href, actor) as never);

  const refresh = () => {
    summary.refetch();
    trend.refetch();
    queryClient.invalidateQueries({ queryKey: ['viewer'] });
    queryClient.invalidateQueries({ queryKey: ['account', 'note'] });
    queryClient.invalidateQueries({ queryKey: ['employer', 'suspension'] });
    queryClient.invalidateQueries({ queryKey: ['appeal'] });
  };

  const header = (
    <View>
      <Text variant="title" weight="bold" accessibilityRole="header">
        {t('dashboard.overview')}
      </Text>
      <Text tone="mutedForeground">{t('dashboard.employerLede')}</Text>
    </View>
  );
  const standing = profile ? <StandingNotice profile={profile} company={company} /> : null;

  let body: React.ReactNode;
  if (summary.isPending) {
    body = <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />;
  } else if (!s || !s.has_company) {
    body = isSuspended(actor) ? null : (
      <View
        style={{
          alignItems: 'center',
          gap: space[2],
          paddingVertical: space[8],
          paddingHorizontal: space[6],
          borderRadius: radius.xl,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.border,
        }}
      >
        <Text weight="medium" style={{ textAlign: 'center' }}>
          {t('dashboard.emptyEmployerTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('dashboard.emptyEmployerBody')}
        </Text>
        <View style={{ marginTop: space[2] }}>
          <Button label={t('dashboard.emptyEmployerCta')} onPress={() => go('/employer/company')} />
        </View>
      </View>
    );
  } else {
    const next = employerNextAction(s);
    const listed = s.live_jobs + s.pending_jobs > 0;
    // Against a week with no applicants a change is noise, so there is none.
    const delta =
      s.applicants_prev_7d > 0
        ? {
            value: `${n(Math.round(((s.applicants_7d - s.applicants_prev_7d) / s.applicants_prev_7d) * 100))}%`,
            direction:
              s.applicants_7d > s.applicants_prev_7d
                ? ('up' as const)
                : s.applicants_7d < s.applicants_prev_7d
                  ? ('down' as const)
                  : ('flat' as const),
          }
        : undefined;

    body = (
      <>
        {next ? (
          <NextAction
            kind={next.kind}
            tone={next.tone}
            title={t(`dashboard.next${next.key}Title` as 'dashboard.nextApplicantsTitle', { count: next.count })}
            body={t(`dashboard.next${next.key}Body` as 'dashboard.nextApplicantsBody')}
            cta={t(`dashboard.next${next.key}Cta` as 'dashboard.nextApplicantsCta')}
            onPress={() => go(next.href)}
          />
        ) : null}

        {listed ? null : (
          <SetupChecklist company={company} liveJobs={s.live_jobs} pendingJobs={s.pending_jobs} draftJobs={s.draft_jobs} />
        )}

        {standing}

        {listed ? (
          <View style={{ gap: space[2] }}>
            <StatStrip
              label={t('dashboard.overview')}
              cells={[
                {
                  label: t('dashboard.statApplicantsNew'),
                  value: n(s.applicants_new),
                  tone: s.applicants_new > 0 ? 'accent' : 'default',
                  onPress: () => go('/employer/applicants?stage=new'),
                },
                {
                  label: t('dashboard.statApplicants7d'),
                  value: n(s.applicants_7d),
                  hint: delta ? t('dashboard.vsLastWeek') : undefined,
                  delta,
                  onPress: () => go('/employer/applicants'),
                },
                {
                  label: t('dashboard.statExpiring'),
                  value: n(s.expiring_soon),
                  tone: s.expiring_soon > 0 ? 'urgent' : 'default',
                  onPress: () => go('/employer/jobs'),
                },
                { label: t('dashboard.statLiveJobs'), value: n(s.live_jobs), onPress: () => go('/employer/jobs') },
                {
                  label: t('dashboard.statPending'),
                  value: n(s.pending_jobs),
                  tone: s.pending_jobs > 0 ? 'warn' : 'default',
                  onPress: () => go('/employer/jobs'),
                },
              ]}
            />
            <StatStrip
              label={t('employer.company')}
              cells={[
                { label: t('dashboard.statViews'), value: n(s.total_views), onPress: () => go('/employer/jobs') },
                { label: t('dashboard.statSeats'), value: n(s.seats_advertised), onPress: () => go('/employer/jobs') },
                { label: t('dashboard.statCredits'), value: n(s.credits), onPress: () => go('/employer/billing') },
                {
                  label: t('dashboard.statVerification'),
                  value: s.verification === 'verified' ? t('companies.verified') : t('companies.unverified'),
                  tone: s.verification === 'verified' ? 'good' : 'warn',
                  onPress: () => go('/employer/company'),
                },
              ]}
            />
          </View>
        ) : null}

        {listed && trend.data?.has_company ? (
          <>
            <TrendBars
              title={t('dashboard.trendApplicationsTitle')}
              hint={t('dashboard.trendApplicationsHint')}
              days={trend.data.days.map((day) => day.d)}
              values={trend.data.days.map((day) => day.applications)}
              empty={t('dashboard.trendEmpty')}
              totalLabel={t('dashboard.statApplicants')}
            />
            <ConversionBars rows={trend.data.conversion} />
          </>
        ) : null}
      </>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl refreshing={summary.isRefetching || trend.isRefetching} onRefresh={refresh} tintColor={colors.primary} />
      }
      contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
    >
      {header}
      {/* Without a company (and so without figures) the standing still comes first. */}
      {s?.has_company ? null : standing}
      {body}
    </ScrollView>
  );
}
