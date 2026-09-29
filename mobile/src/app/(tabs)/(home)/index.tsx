import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, type Href } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Briefcase, Building2, Check, Search, Users } from '~/components/ui/lucide';
import { formatNumber } from '@/lib/format';
import { canAccessCandidateArea, canAccessEmployerArea } from '@/lib/permissions';
import { CandidateHome } from '~/components/home/candidate-home';
import { EmployerHome } from '~/components/home/employer-home';
import { JobBrowse } from '~/components/home/job-browse';
import { HeaderBell } from '~/components/notifications/header-bell';
import { JobCard } from '~/components/jobs/job-card';
import { Button } from '~/components/ui/button';
import { ForwardChevron } from '~/components/ui/icons';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useBrowseCounts } from '~/features/browse/queries';
import { flattenBoard, useJobBoard } from '~/features/jobs/queries';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useDistricts } from '~/features/taxonomy';
import { inOwnTab } from '~/lib/links';
import { useSession } from '~/lib/session';
import { tabsFor } from '~/lib/tabs';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';

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
      <Stack.Screen options={{ title: t('meta.siteName'), headerLargeTitle: true, headerRight: () => <HeaderBell /> }} />
      {canAccessEmployerArea(actor) ? (
        <EmployerHome profile={viewer?.profile ?? null} company={viewer?.company ?? null} />
      ) : canAccessCandidateArea(actor) ? (
        <CandidateHome profile={viewer?.profile ?? null} />
      ) : (
        <MarketHome />
      )}
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
  const districts = useDistricts();

  const jobs = withoutHidden(flattenBoard(board.data?.pages), useHiddenCompanies()).slice(0, 20);
  const total = board.data?.pages[0]?.total ?? 0;
  const name = viewer?.profile?.full_name;

  const featured = name ? jobs.filter((job) => job.is_featured).slice(0, 2) : [];
  const latest = jobs.filter((job) => !featured.includes(job)).slice(0, 6);
  const openSeats = jobs.reduce((sum, job) => sum + job.seats, 0);

  const search = () => {
    const words = q.trim();
    router.navigate(words ? { pathname: '/jobs', params: { q: words } } : '/jobs');
  };

  const refreshing = board.isRefetching || counts.isRefetching;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            board.refetch();
            counts.refetch();
          }}
          tintColor={colors.primary}
        />
      }
      contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[8] }}
    >
      <View style={{ gap: space[3] }}>
        {name ? (
          <View>
            <Text variant="title" weight="bold" accessibilityRole="header">
              {t('home.welcome', { name })}
            </Text>
            <Text tone="mutedForeground">{t('home.welcomeLede')}</Text>
          </View>
        ) : (
          <View>
            <Text variant="display" weight="bold" accessibilityRole="header">
              {t('landingPage.hero.title')}
            </Text>
            <Text tone="mutedForeground" style={{ marginTop: space[1] }}>
              {t('landingPage.hero.subtitle')}
            </Text>
          </View>
        )}

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
        />
        <Button label={name ? t('home.searchButton') : t('landingPage.hero.cta')} onPress={search} />

        {name ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Check size={16} color={colors.success} />
            <Text variant="small" tone="mutedForeground">
              {t('landingPage.hero.trustNoSpam')}
            </Text>
          </View>
        )}
      </View>

      {name ? null : <JobBrowse counts={counts.data} districts={districts.data} />}

      {latest.length || featured.length ? (
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] }}>
            <Text variant="title" weight="bold" accessibilityRole="header" style={{ flexShrink: 1 }}>
              {name ? t('home.latestJobs') : t('landingPage.latest.title')}
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.navigate('/jobs')}
              hitSlop={8}
              style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: 2 }}
            >
              <Text variant="small" weight="medium" tone="primary">
                {t('jobs.title')}
              </Text>
              <ForwardChevron size={16} color={colors.primary} />
            </Pressable>
          </View>

          {/* The market in two labelled figures, for somebody who comes back. */}
          {name ? (
            <View style={{ flexDirection: 'row', gap: space[4] }}>
              <Fact icon={<Briefcase size={14} color={colors.mutedForeground} />} value={formatNumber(total, locale)} label={t('home.statJobs')} />
              <Fact icon={<Users size={14} color={colors.mutedForeground} />} value={formatNumber(openSeats, locale)} label={t('home.statSeats')} />
            </View>
          ) : null}

          {featured.length ? (
            <View style={{ gap: space[2] }}>
              <Text variant="small" weight="medium" tone="mutedForeground">
                {t('home.featuredJobs')}
              </Text>
              {featured.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
              <Text variant="small" weight="medium" tone="mutedForeground" style={{ marginTop: space[3] }}>
                {t('home.newestJobs')}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: space[2] }}>
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
