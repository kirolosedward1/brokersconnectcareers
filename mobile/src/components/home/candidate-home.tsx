import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { Building2 } from '~/components/ui/lucide';
import { formatDate, formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { NextAction } from '~/components/dashboard/next-action';
import { StandingNotice } from '~/components/dashboard/standing-notice';
import { PushPrompt } from '~/components/push/push-prompt';
import { StatStrip } from '~/components/dashboard/stat-strip';
import { JobBrowse } from '~/components/home/job-browse';
import { JobCard } from '~/components/jobs/job-card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { ForwardChevron } from '~/components/ui/icons';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { STATUS_VARIANT, useMyApplications, type CandidateApplication } from '~/features/applications/queries';
import { useBrowseCounts } from '~/features/browse/queries';
import {
  candidateNextAction,
  COMPLETENESS_WARN,
  useSuggestions,
  type Suggestion,
} from '~/features/dashboard/candidate';
import { useAgentProfile, useCandidateSummary } from '~/features/profile/queries';
import { useDistricts } from '~/features/taxonomy';
import { inOwnTab } from '~/lib/links';
import { useSession } from '~/lib/session';
import { tabsFor } from '~/lib/tabs';
import { useTheme } from '~/theme/provider';
import { hitTarget, radius, space } from '~/theme/tokens';

/**
 * A candidate's Home — the website's /dashboard, which the app opens on.
 *
 * Opened to learn whether anything happened and what to do next, so it says
 * that first: where the account stands when it is not in good standing, the
 * one next action, the figures (each a way to where it can be changed), the
 * latest applications and roles worth a look — ranked against the profile,
 * and saying why. Then the ways into the board and the directory, which a
 * candidate's tab bar has no tab for.
 *
 * The figures and the applications are drawn once both are read, so nothing
 * moves under a thumb; a read that failed never says "you have not applied".
 */
export function CandidateHome({ profile }: { profile: ProfileRow | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { actor } = useSession();

  const summary = useCandidateSummary();
  const applications = useMyApplications();
  const agent = useAgentProfile();
  const { suggestions, personalised, profileKnown, board } = useSuggestions();
  const counts = useBrowseCounts();
  const districts = useDistricts();

  const s = summary.data ?? null;
  const n = (value: number) => formatNumber(value, locale);
  const next = candidateNextAction(s);
  const recent = (applications.data ?? []).filter((application) => application.job).slice(0, 3);
  const figuresPending = summary.isPending || applications.isPending;
  const unreadable = !s && applications.isError;
  const noApplications = s ? s.applications_total === 0 : applications.isSuccess && applications.data.length === 0;

  const refresh = () => {
    summary.refetch();
    applications.refetch();
    agent.refetch();
    board.refetch();
    counts.refetch();
    // Where the account stands can change while the app is open.
    queryClient.invalidateQueries({ queryKey: ['viewer'] });
    queryClient.invalidateQueries({ queryKey: ['account', 'note'] });
    queryClient.invalidateQueries({ queryKey: ['appeal'] });
  };
  const refreshing = summary.isRefetching || applications.isRefetching || board.isRefetching;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // An appeal is typed on Home: its Send takes the first tap, and the field is lifted above the keyboard.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
    >
      <View>
        {/* The profile is read again on every start; offline, the page is the same without the name. */}
        <Text variant="title" weight="bold" accessibilityRole="header">
          {profile ? t('dashboard.candidateGreeting', { name: profile.full_name }) : t('dashboard.overview')}
        </Text>
        <Text tone="mutedForeground">{t('dashboard.candidateLede')}</Text>
      </View>

      {profile ? <StandingNotice profile={profile} /> : null}

      {/* The phone's question, with its reason, until it has been answered. */}
      {profile ? <PushPrompt audience="candidate" /> : null}

      {figuresPending ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      ) : (
        <>
          {next ? (
            next.kind === 'replies' && s ? (
              <NextAction
                kind="replies"
                tone={next.tone}
                title={t('dashboard.nextRepliesTitle', { count: s.replies })}
                body={t('dashboard.nextRepliesBody')}
                cta={t('dashboard.nextRepliesCta')}
                onPress={() => router.navigate(next.href)}
              />
            ) : (
              <NextAction
                kind="profile"
                tone={next.tone}
                title={t('dashboard.nextProfileTitle')}
                body={t('dashboard.nextProfileBody')}
                cta={t('dashboard.nextProfileCta')}
                onPress={() => router.navigate(next.href)}
              />
            )
          ) : null}

          {unreadable ? (
            <Notice tone="destructive" title={t('common.error')}>
              <Text variant="small">{t('common.errorBody')}</Text>
              <View style={{ alignItems: 'flex-start', marginTop: space[2] }}>
                <Button label={t('common.retry')} size="sm" variant="outline" onPress={refresh} />
              </View>
            </Notice>
          ) : null}

          {noApplications ? (
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
                {t('dashboard.emptyCandidateTitle')}
              </Text>
              <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
                {t('dashboard.emptyCandidateBody')}
              </Text>
              <View style={{ marginTop: space[2] }}>
                <Button label={t('jobs.title')} onPress={() => router.navigate('/jobs')} />
              </View>
            </View>
          ) : null}

          {s ? (
            <StatStrip
              label={t('dashboard.overview')}
              cells={[
                {
                  label: t('dashboard.statApplications'),
                  value: n(s.applications_total),
                  onPress: () => router.navigate('/dashboard/applications'),
                },
                {
                  label: t('dashboard.statReplies'),
                  value: n(s.replies),
                  tone: s.replies > 0 ? 'good' : 'default',
                  onPress: () => router.navigate('/dashboard/applications'),
                },
                {
                  label: t('dashboard.statCompleteness'),
                  value: `${n(s.profile_completeness)}%`,
                  tone: s.profile_completeness < COMPLETENESS_WARN ? 'warn' : 'default',
                  onPress: () => router.navigate('/account/profile'),
                },
                { label: t('dashboard.statSaved'), value: n(s.saved_jobs), onPress: () => router.navigate('/dashboard/saved') },
                { label: t('dashboard.statAlerts'), value: n(s.alerts_on), onPress: () => router.navigate('/dashboard/saved') },
              ]}
            />
          ) : null}

          {recent.length ? (
            <View style={{ gap: space[3] }}>
              <SectionHeader title={t('dashboard.applications')} onSeeAll={() => router.navigate('/dashboard/applications')} />
              <View
                style={{
                  borderRadius: radius.xl,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  overflow: 'hidden',
                }}
              >
                {recent.map((application, index) => (
                  <RecentApplication key={application.id} application={application} first={index === 0} />
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}

      {suggestions.length ? (
        <View style={{ gap: space[3] }}>
          <SectionHeader
            title={personalised ? t('dashboard.matchedRoles') : t('dashboard.openRoles')}
            onSeeAll={() => router.navigate('/jobs')}
          />

          {/* Newest-first dressed up as a recommendation would be a lie; say what is missing instead. */}
          {!personalised && profileKnown ? (
            <View
              style={{
                gap: space[1],
                paddingHorizontal: space[4],
                paddingVertical: space[3],
                borderRadius: radius.xl,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.border,
              }}
            >
              <Text variant="small" tone="mutedForeground">
                {t('dashboard.matchNudge')}
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.navigate('/account/profile')}
                style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: space[1] }}
              >
                <Text variant="small" weight="medium" tone="primary" style={{ flexShrink: 1 }}>
                  {t('dashboard.matchNudgeCta')}
                </Text>
                <ForwardChevron size={16} color={colors.primary} />
              </Pressable>
            </View>
          ) : null}

          {suggestions.map((suggestion) => (
            <SuggestedRole
              key={suggestion.job.id}
              suggestion={suggestion}
              districtName={(id) => {
                const district = districts.data?.find((row) => row.id === id);
                return district ? localized(locale, district.name_ar, district.name_en) : null;
              }}
            />
          ))}
        </View>
      ) : null}

      <JobBrowse counts={counts.data} districts={districts.data} />

      {/* The directory, which a candidate's tab bar has no tab for. */}
      <Button
        label={t('nav.companies')}
        variant="outline"
        icon={<Building2 size={16} color={colors.foreground} />}
        onPress={() => router.push(inOwnTab('/companies', tabsFor(actor)) as Href)}
      />
    </ScrollView>
  );
}

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll: () => void }) {
  const t = useTranslations('dashboard');
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
      <Text weight="semibold" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${t('seeAll')}: ${title}`}
        onPress={onSeeAll}
        hitSlop={8}
        style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: 2 }}
      >
        <Text variant="small" weight="medium" tone="primary">
          {t('seeAll')}
        </Text>
        <ForwardChevron size={16} color={colors.primary} />
      </Pressable>
    </View>
  );
}

function RecentApplication({ application, first }: { application: CandidateApplication; first: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const job = application.job;
  if (!job) return null;

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);
  const status = t(`applicationStatus.${application.status}`);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={formatList([title, company, status], locale)}
      onPress={() => router.push({ pathname: '/jobs/[slug]', params: { slug: job.slug } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="small" tone="mutedForeground" numberOfLines={1}>
          {`${company} · ${formatDate(application.created_at, locale)}`}
        </Text>
      </View>
      <Badge variant={STATUS_VARIANT[application.status]} label={status} />
    </Pressable>
  );
}

function SuggestedRole({
  suggestion: { job, score, reasons },
  districtName,
}: {
  suggestion: Suggestion;
  districtName: (id: number) => string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();

  // Why this one, in the candidate's own words — the track and district they
  // put on their profile, not a score. A recommendation nobody can check is
  // one they are entitled to distrust.
  const why = [
    reasons.track ? t(`track.${reasons.track}`) : null,
    reasons.districtId ? districtName(reasons.districtId) : null,
    reasons.experience ? t('dashboard.matchExperience') : null,
  ].filter((reason): reason is string => Boolean(reason));

  return (
    <View style={{ gap: space[1] }}>
      <JobCard job={job} />
      {score > 0 && why.length ? (
        <Text variant="caption" tone="mutedForeground" style={{ paddingHorizontal: space[1] }}>
          <Text variant="caption" weight="medium">
            {t('dashboard.matchWhy')}
          </Text>{' '}
          {formatList(why, locale)}
        </Text>
      ) : null}
    </View>
  );
}
