import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, type Href } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Briefcase, Building2, Check, Search } from '~/components/ui/lucide';
import { formatNumber } from '@/lib/format';
import { canAccessCandidateArea, canAccessEmployerArea } from '@/lib/permissions';
import { CandidateHome } from '~/components/home/candidate-home';
import { EmployerHome } from '~/components/home/employer-home';
import { HomeFrame } from '~/components/home/home-frame';
import { Hero } from '~/components/home/hero';
import { JobBrowse } from '~/components/home/job-browse';
import { PolicyNotice } from '~/components/legal/policy-notice';
import { JobCard } from '~/components/jobs/job-card';
import { Button } from '~/components/ui/button';
import { SectionHeader } from '~/components/ui/section-header';
import { ErrorState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useBrowseCounts } from '~/features/browse/queries';
import { flattenBoard, useJobBoard } from '~/features/jobs/queries';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useDistricts } from '~/features/taxonomy';
import { useTabList } from '~/features/tab-bar';
import { inOwnTab } from '~/lib/links';
import { useSession } from '~/lib/session';
import { tabsFor } from '~/lib/tabs';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';
import { usePullRefresh } from '~/lib/use-pull-refresh';

/**
 * Home — the website's home page for the phone, and a candidate's console.
 *
 * A candidate opens on their overview (the website's /dashboard, which the
 * app keeps here): CandidateHome. An employer on theirs (/employer):
 * EmployerHome.
 *
 * Signed out, the product before the pitch: a search, the ways into the board
 * with live counts, then the newest listings (the website's Landing, without
 * the marketing sections a reader who installed the app has already read).
 * Signed in otherwise, the website's SignedInHome: a greeting, the same
 * search, the market in two figures, featured and newest roles, and the same
 * index.
 *
 * Every read is allowed to fail on its own: the counts and the listings each
 * step aside rather than take the screen down, as they do on the website.
 */
export default function HomeScreen() {
  const t = useTranslations();
  const { viewer, actor } = useSession();
  return (
    <>
      {/* Its own header (HomeFrame), not the stack's: the name stays the title for Back and VoiceOver. */}
      <Stack.Screen options={{ title: t('meta.siteName'), headerShown: false }} />
      <HomeFrame>
        {canAccessEmployerArea(actor) ? (
          <EmployerHome profile={viewer?.profile ?? null} company={viewer?.company ?? null} />
        ) : canAccessCandidateArea(actor) ? (
          <CandidateHome profile={viewer?.profile ?? null} />
        ) : (
          <MarketHome />
        )}
      </HomeFrame>
    </>
  );
}

function MarketHome() {
  const locale = useLocale();
  const t = useTranslations();
  const { colors } = useTheme();
  const { viewer, actor } = useSession();
  const [q, setQ] = useState('');

  const board = useJobBoard('');
  const counts = useBrowseCounts();
  // The spinner is the reader's pull, not a re-read on coming back to the app.
  const pull = usePullRefresh(() => Promise.all([board.refetch(), counts.refetch()]));
  const list = useTabList();
  const districts = useDistricts();

  const jobs = withoutHidden(flattenBoard(board.data?.pages), useHiddenCompanies()).slice(0, 20);
  const total = board.data?.pages[0]?.total ?? 0;
  const name = viewer?.profile?.full_name;

  const featured = name ? jobs.filter((job) => job.is_featured).slice(0, 2) : [];
  const latest = jobs.filter((job) => !featured.includes(job)).slice(0, 6);

  const search = () => {
    const words = q.trim();
    router.navigate(words ? { pathname: '/jobs', params: { q: words } } : '/jobs');
  };

  return (
    <ScrollView
      {...list}
      contentInsetAdjustmentBehavior="automatic"
      // The search sits in the top half: on a small phone the keyboard would cover it without this.
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={colors.primary}
        />
      }
      contentContainerStyle={{ padding: gutter, paddingBottom: space[12], gap: space[8] }}
    >
      <View style={{ gap: space[4] }}>
        <Hero
          eyebrow={name ? undefined : t('landingPage.hero.eyebrow')}
          title={name ? t('home.welcome', { name }) : t('landingPage.hero.title')}
          subtitle={name ? t('home.welcomeLede') : t('landingPage.hero.subtitle')}
        >
          <TextField
            value={q}
            onChangeText={setQ}
            onSubmitEditing={search}
            returnKeyType="search"
            enterKeyHint="search"
            autoCorrect={false}
            placeholder={name ? t('home.searchPlaceholder') : t('landingPage.hero.searchPlaceholder')}
            accessibilityLabel={t('landingPage.hero.searchLabel')}
            leading={<Search size={18} color={colors.mutedForeground} />}
            // The panel is the brand colour: a ring in it would vanish into it.
            focusColor={colors.champagne}
          />
          <Button
            label={name ? t('home.searchButton') : t('landingPage.hero.cta')}
            variant="champagne"
            size="lg"
            onPress={search}
          />

          {name ? null : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Check size={16} color={colors.champagne} strokeWidth={2.5} />
              <Text variant="small" style={{ color: colors.onHeroMuted, flexShrink: 1 }}>
                {t('landingPage.hero.trustNoSpam')}
              </Text>
            </View>
          )}
        </Hero>

        {/* The Terms and the Privacy policy as they are now, until agreed to. */}
        {name ? <PolicyNotice /> : null}
      </View>

      {name ? null : <JobBrowse counts={counts.data} districts={districts.data} />}

      {/* Nothing to show and nothing kept from a last run (a first launch with
          no connection): said, with the way to try again — not a bare hero
          that stays bare when the connection comes back. */}
      {board.isError && !board.data ? (
        <ErrorState
          error={board.error}
          onRetry={() => {
            void board.refetch();
            void counts.refetch();
          }}
        />
      ) : null}

      {latest.length || featured.length ? (
        <View style={{ gap: space[4] }}>
          <SectionHeader
            title={name ? t('home.latestJobs') : t('landingPage.latest.title')}
            action={t('jobs.title')}
            onAction={() => router.navigate('/jobs')}
          />

          {/* The market in a labelled figure, for somebody who comes back. Live
              listings only: an open-seats figure summed the first page and sat
              beside the board's total as if it were the market's. */}
          {name ? (
            <View style={{ flexDirection: 'row', gap: space[4] }}>
              <Fact icon={<Briefcase size={14} color={colors.mutedForeground} />} value={formatNumber(total, locale)} label={t('home.statJobs')} />
            </View>
          ) : null}

          {featured.length ? (
            <View style={{ gap: space[3] }}>
              <Text variant="label" weight="semibold" tone="mutedForeground">
                {t('home.featuredJobs')}
              </Text>
              {featured.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
              <Text variant="label" weight="semibold" tone="mutedForeground" style={{ marginTop: space[3] }}>
                {t('home.newestJobs')}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: space[3] }}>
            {latest.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </View>

          <Button label={t('home.browseAll')} variant="outline" onPress={() => router.navigate('/jobs')} />
        </View>
      ) : null}

      {name ? <JobBrowse counts={counts.data} districts={districts.data} /> : null}

      {/* The directory, for somebody whose tab bar has no Companies tab (a candidate's). */}
      {tabsFor(actor).includes('companies') ? null : (
        <Button
          label={t('nav.companies')}
          variant="outline"
          icon={<Building2 size={16} color={colors.foreground} />}
          onPress={() => router.push(inOwnTab('/companies', tabsFor(actor)) as Href)}
        />
      )}
    </ScrollView>
  );
}

function Fact({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
      {icon}
      <Text variant="small" weight="semibold">
        {value}
      </Text>
      <Text variant="small" tone="mutedForeground">
        {label}
      </Text>
    </View>
  );
}
