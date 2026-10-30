import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import { Building2, Search, SlidersHorizontal } from '~/components/ui/lucide';
import { formatDate, formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { NextAction } from '~/components/dashboard/next-action';
import { StandingNotice } from '~/components/dashboard/standing-notice';
import { PolicyNotice } from '~/components/legal/policy-notice';
import { PushPrompt } from '~/components/push/push-prompt';
import { StatRowPlaceholder } from '~/components/dashboard/stat-row';
import { CounterTiles } from '~/components/dashboard/counter-tiles';
import { WeeklySummary } from '~/components/home/weekly-summary';
import { JobBrowse } from '~/components/home/job-browse';
import { RecentlyViewed } from './recently-viewed';
import { CompletenessRing } from '~/components/profile/completeness-ring';
import { JobCard } from '~/components/jobs/job-card';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { ForwardChevron } from '~/components/ui/icons';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { STAGE_TONE } from '@/lib/application-stages';
import { useMyApplications, type CandidateApplication } from '~/features/applications/queries';
import { useBrowseCounts } from '~/features/browse/queries';
import { candidateNextAction, useCompletenessReached, useSuggestions, type Suggestion } from '~/features/dashboard/candidate';
import { useUnchosenVisibility } from '~/features/policies';
import { useAgentProfile, useCandidateSummary } from '~/features/profile/queries';
import { useDistricts } from '~/features/taxonomy';
import { useTabList } from '~/features/tab-bar';
import { markupTags } from '~/i18n/rich';
import { inOwnTab } from '~/lib/links';
import { useSession } from '~/lib/session';
import { usePullRefresh } from '~/lib/use-pull-refresh';
import { tabsFor } from '~/lib/tabs';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

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
  const { colors, shadow } = useTheme();
  const queryClient = useQueryClient();
  const { actor } = useSession();

  const summary = useCandidateSummary();
  const applications = useMyApplications();
  const agent = useAgentProfile();
  const { suggestions, personalised, profileKnown, board } = useSuggestions();
  const counts = useBrowseCounts();
  const districts = useDistricts();

  const s = summary.data ?? null;
  const next = candidateNextAction(s);
  const recent = (applications.data ?? []).filter((application) => application.job).slice(0, 3);
  const figuresPending = summary.isPending || applications.isPending;
  const unreadable = !s && applications.isError;
  const noApplications = s ? s.applications_total === 0 : applications.isSuccess && applications.data.length === 0;
  const hasApplied = s ? s.applications_total > 0 : (applications.data?.length ?? 0) > 0;

  const refresh = () =>
    Promise.all([
      summary.refetch(),
      applications.refetch(),
      agent.refetch(),
      board.refetch(),
      counts.refetch(),
      // Where the account stands can change while the app is open.
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['account', 'note'] }),
      queryClient.invalidateQueries({ queryKey: ['appeal'] }),
    ]);
  // The spinner is the pull's alone: a push reads the summary and the
  // applications again too, and a spinner that starts by itself pushes the
  // page down under the reader's finger.
  const pull = usePullRefresh(refresh);
  const list = useTabList();

  // The completeness the product promises something at, once per step on this phone: the end of sign up → profile 60%.
  useCompletenessReached(s?.profile_completeness ?? null);

  // The roles that fit, right under the figures (v1.1): the reason Home is opened.
  const matching = suggestions.length ? (
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
                ...corner('xl'),
                borderWidth: StyleSheet.hairlineWidth * 2,
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
      ) : null;

  return (
    <ScrollView
      {...list}
      contentInsetAdjustmentBehavior="automatic"
      // An appeal is typed on Home: its Send takes the first tap, and the field is lifted above the keyboard.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl {...pull} tintColor={colors.primary} />}
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[6] }}
    >
      {/* The profile is read again on every start; offline, the page is the same without the name. */}
      <Greeting profile={profile} completeness={s?.profile_completeness ?? null} companiesLooked={s?.profile_views_30d ?? 0} />

      {/* Search, a tap from Home (v1.1): its own screen, and the board's filters beside it. */}
      <SearchRow />

      {profile ? <StandingNotice profile={profile} /> : null}

      {/* The Terms and the Privacy policy as they are now, until agreed to. */}
      {profile ? <PolicyNotice /> : null}

      {/* Who sees their directory card was decided before onboarding asked. */}
      {profile ? <VisibilityAsk /> : null}

      {/* The phone's question, with its reason — once there is an application to hear back on — until answered. */}
      {profile && hasApplied ? <PushPrompt audience="candidate" /> : null}

      {figuresPending ? (
        <StatRowPlaceholder count={5} label={t('common.loading')} />
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
                <Button label={t('common.retry')} size="sm" variant="outline" onPress={() => void refresh()} />
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
                ...corner('xl'),
                borderWidth: StyleSheet.hairlineWidth * 2,
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
                <Button label={t('nav.browseJobs')} onPress={() => router.navigate('/jobs')} />
              </View>
            </View>
          ) : null}

          {s ? (
            <CounterTiles
              label={t('dashboard.overview')}
              tiles={[
                { label: t('dashboard.statApplications'), short: t('app.home.statApplications'), value: s.applications_total, onPress: () => router.navigate('/dashboard/applications') },
                { label: t('dashboard.statReplies'), short: t('app.home.statReplies'), value: s.replies, good: s.replies > 0, onPress: () => router.navigate('/dashboard/applications') },
                { label: t('dashboard.statSaved'), short: t('app.home.statSaved'), value: s.saved_jobs, onPress: () => router.navigate('/dashboard/saved') },
                { label: t('dashboard.statAlerts'), short: t('app.home.statAlerts'), value: s.alerts_on, onPress: () => router.navigate('/dashboard/saved') },
              ]}
            />
          ) : null}

          {matching}

          {s ? (
            <WeeklySummary
              districtIds={agent.data?.agent?.district_ids ?? []}
              applications={applications.data ?? []}
              readAt={applications.dataUpdatedAt}
              profileViews={s.profile_views_30d ?? 0}
            />
          ) : null}

          {recent.length ? (
            <View style={{ gap: space[3] }}>
              <SectionHeader title={t('dashboard.applications')} onSeeAll={() => router.navigate('/dashboard/applications')} />
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
                {recent.map((application, index) => (
                  <RecentApplication key={application.id} application={application} first={index === 0} />
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}

      <RecentlyViewed />

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

/**
 * The greeting, as the design draws it (Main): the reader's photo — the
 * generic figure until they add one — ringed by how complete the profile is
 * (a tap opens it at what is missing), "أهلًا" and their name, and one line:
 * how complete, and how many companies opened the profile lately when any did.
 */
function Greeting({ profile, completeness, companiesLooked }: { profile: ProfileRow | null; completeness: number | null; companiesLooked: number }) {
  const t = useTranslations();
  const locale = useLocale();
  const parts = [
    completeness !== null ? t.markup('app.home.completeLine', { percent: formatNumber(completeness, locale), ...markupTags }) : null,
    companiesLooked > 0 ? t.markup('app.home.lookedLine', { count: companiesLooked, ...markupTags }) : null,
  ].filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
      {profile ? (
        <CompletenessRing percent={completeness} size={52} radius={26} onPress={() => router.navigate('/account/profile')}>
          <Avatar name={profile.full_name} src={profile.avatar_url} size="md" />
        </CompletenessRing>
      ) : null}
      <View style={{ flex: 1, gap: space[0.5] }}>
        <Text variant="title" weight="bold" accessibilityRole="header">
          {profile ? t('dashboard.candidateGreeting', { name: profile.full_name.trim().split(/\s+/)[0] ?? profile.full_name }) : t('dashboard.overview')}
        </Text>
        {parts.length ? (
          <Text variant="caption" tone="mutedForeground">
            {parts.join(' · ')}
          </Text>
        ) : (
          <Text variant="caption" tone="mutedForeground">
            {t('dashboard.candidateLede')}
          </Text>
        )}
      </View>
    </View>
  );
}

/** A search field that opens the Search screen, and the board's filters beside it (v1.1, Main). */
function SearchRow() {
  const t = useTranslations();
  const { colors } = useTheme();
  const large = useLargeText();
  return (
    <View style={{ flexDirection: 'row', gap: space[2.5] }}>
      <Pressable
        accessibilityRole="search"
        accessibilityLabel={t('app.search.title')}
        accessibilityHint={t('app.home.searchHint')}
        onPress={() => router.push('/jobs/search')}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2.5],
          minHeight: 50,
          paddingHorizontal: space[3.5],
          ...corner('lg'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.muted : colors.card,
        })}
      >
        <Search size={20} color={colors.mutedForeground} />
        <Text tone="mutedForeground" numberOfLines={large ? undefined : 1} style={{ flex: 1 }}>
          {t('app.home.searchPlaceholder')}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('app.home.filters')}
        onPress={() => router.navigate({ pathname: '/jobs', params: { sheet: 'filters' } })}
        style={({ pressed }) => ({
          width: 50,
          height: 50,
          ...corner('lg'),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? colors.primaryPressed : colors.primary,
        })}
      >
        <SlidersHorizontal size={20} color={colors.primaryForeground} />
      </Pressable>
    </View>
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
  const large = useLargeText();
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
      // At the accessibility sizes the status goes under the title rather than
      // squeezing it to a word a line.
      style={({ pressed }) => ({
        flexDirection: large ? 'column' : 'row',
        alignItems: large ? 'flex-start' : 'center',
        gap: large ? space[2] : space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <View style={[{ gap: 2 }, large ? { alignSelf: 'stretch' } : { flex: 1 }]}>
        <Text weight="medium" numberOfLines={large ? undefined : 1}>
          {title}
        </Text>
        <Text variant="small" tone="mutedForeground" numberOfLines={large ? undefined : 1}>
          {`${company} · ${formatDate(application.created_at, locale)}`}
        </Text>
      </View>
      <Badge variant={STAGE_TONE[application.status]} label={status} />
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

/**
 * The website's question on /dashboard: a directory card listed before
 * anybody asked its owner (visibility_chosen_at null, migration 336). Asked
 * once, until they choose on their profile.
 */
function VisibilityAsk() {
  const t = useTranslations();
  const current = useUnchosenVisibility(true).data ?? null;
  if (!current) return null;
  return (
    <Notice tone="muted" title={t('dashboard.visibilityAskTitle')}>
      <View style={{ gap: space[3] }}>
        <Text variant="small">{t('dashboard.visibilityAskBody', { current: t(`visibility.${current}`) })}</Text>
        <View style={{ alignItems: 'flex-start' }}>
          <Button label={t('dashboard.visibilityAskCta')} size="sm" onPress={() => router.navigate('/account/profile')} />
        </View>
      </View>
    </Notice>
  );
}
