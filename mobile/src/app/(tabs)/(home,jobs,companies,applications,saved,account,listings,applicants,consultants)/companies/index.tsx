import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useLocale, useTranslations } from 'use-intl';
import type { SearchBarCommands } from 'react-native-screens';
import { BadgeCheck, Briefcase, Building2, MapPin } from '~/components/ui/lucide';
import type { CompanyListItem } from '@/lib/read-types';
import { formatList, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import { HeaderBell } from '~/components/notifications/header-bell';
import { CompanyLogo } from '~/components/companies/company-logo';
import { Button } from '~/components/ui/button';
import { PageFooter } from '~/components/ui/page-footer';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { EmptyState, ErrorState, SkeletonList } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { flattenCompanies, useCompanyDirectory, type CompanyQuery } from '~/features/companies/queries';
import { useHiddenCompanies } from '~/features/moderation/hidden-companies';
import { useDistricts } from '~/features/taxonomy';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { usePullRefresh } from '~/lib/use-pull-refresh';

/**
 * The company directory — the website's /companies: companies with a live
 * listing, searchable by name, narrowed to a district or to the verified ones.
 * The same parameters as the site (q, district, verified=1), kept in the
 * route so a link from the website opens the same view.
 */
export default function CompaniesScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ q?: string; district?: string; verified?: string }>();
  const query = useMemo<CompanyQuery>(
    () => ({
      q: typeof params.q === 'string' ? params.q.trim().slice(0, 120) : '',
      district: typeof params.district === 'string' && params.district ? params.district : null,
      verified: params.verified === '1',
    }),
    [params.q, params.district, params.verified],
  );

  const directory = useCompanyDirectory(query);
  const pull = usePullRefresh(() => directory.refetch());
  const hidden = useHiddenCompanies();
  const companies = useMemo(
    () => flattenCompanies(directory.data?.pages).filter((company) => !hidden.has(company.id)),
    [directory.data, hidden],
  );
  const total = directory.data?.pages[0]?.total ?? 0;
  const { data: districts } = useDistricts();
  const district = districts?.find((item) => item.slug === query.district);
  const narrowed = Boolean(query.q || query.district || query.verified);

  const set = (next: Partial<CompanyQuery>) => {
    const merged = { ...query, ...next };
    router.setParams({
      q: merged.q || undefined,
      district: merged.district ?? undefined,
      verified: merged.verified ? '1' : undefined,
    });
  };

  const searchBar = useRef<SearchBarCommands>(null);
  useEffect(() => {
    searchBar.current?.setText(query.q);
  }, [query.q]);

  const header = (
    <Stack.Screen
      options={{
        title: t('companies.title'),
        headerLargeTitle: true,
        headerRight: () => <HeaderBell />,
        headerSearchBarOptions: {
          ref: searchBar,
          placeholder: t('companies.title'),
          hideWhenScrolling: false,
          autoCapitalize: 'none',
          tintColor: colors.primary,
          onSearchButtonPress: (event) => set({ q: event.nativeEvent.text.trim().slice(0, 120) }),
          onCancelButtonPress: () => {
            if (query.q) set({ q: '' });
          },
        },
      }}
    />
  );

  if (directory.isPending) {
    return (
      <>
        {header}
        <SkeletonList count={5} compact />
      </>
    );
  }

  if (directory.isError && !directory.data) {
    return (
      <>
        {header}
        <ErrorState error={directory.error} onRetry={() => directory.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}
      <FlashList
        data={companies}
        keyExtractor={(company) => company.id}
        renderItem={({ item }) => <CompanyRow company={item} />}
        ItemSeparatorComponent={Separator}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={
          <View style={{ gap: space[3], marginBottom: space[4] }}>
            <Text variant="small" tone="mutedForeground">
              {t('companies.lede')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
              <Chip
                label={t('filters.verifiedOnly')}
                selected={query.verified}
                icon={<BadgeCheck size={14} color={query.verified ? colors.primaryForeground : colors.gold} />}
                onPress={() => set({ verified: !query.verified })}
              />
              {query.q ? (
                <Chip
                  label={`«${query.q}»`}
                  removable
                  accessibilityLabel={t('jobs.removeFilter', { name: query.q })}
                  onPress={() => set({ q: '' })}
                />
              ) : null}
              {district ? (
                <Chip
                  label={localized(locale, district.name_ar, district.name_en)}
                  removable
                  accessibilityLabel={t('jobs.removeFilter', { name: localized(locale, district.name_ar, district.name_en) })}
                  onPress={() => set({ district: null })}
                />
              ) : null}
            </View>
            {companies.length ? (
              <Text variant="caption" tone="mutedForeground">
                {t('jobs.resultsCount', { count: total })}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={t('companies.empty')}
            icon={Building2}
            action={
              narrowed ? (
                <Button
                  label={t('jobs.clearFilters')}
                  variant="outline"
                  onPress={() => router.setParams({ q: undefined, district: undefined, verified: undefined })}
                />
              ) : undefined
            }
          />
        }
        ListFooterComponent={<PageFooter query={directory} />}
        onEndReached={() => {
          if (directory.hasNextPage && !directory.isFetchingNextPage) directory.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
      />
    </>
  );
}

function Separator() {
  return <View style={{ height: space[3] }} />;
}

/**
 * A company in the list: its mark, its name (and the badge, when it has one),
 * where it is, and — at the end of the row, where the eye lands last — how
 * many roles are open, as a figure with the sentence kept for VoiceOver.
 */
function CompanyRow({ company }: { company: CompanyListItem }) {
  const locale = useLocale();
  const t = useTranslations('companies');
  const { colors } = useTheme();
  const name = localized(locale, company.name_ar, company.name_en);
  const openRoles = company.open_roles?.[0]?.count ?? 0;
  const district = company.district ? localized(locale, company.district.name_ar, company.district.name_en) : null;

  return (
    <Card
      onPress={() => router.push({ pathname: '/companies/[slug]', params: { slug: company.slug } })}
      accessibilityLabel={formatList(
        [name, company.verification_status === 'verified' ? t('verified') : null, district, t('openRoles', { count: openRoles })].filter(
          (part): part is string => Boolean(part),
        ),
        locale,
      )}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] + 2 }}
    >
      <CompanyLogo name={name} logoUrl={company.logo_url} seed={company.slug} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <Text variant="headline" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {company.verification_status === 'verified' ? <BadgeCheck size={16} color={colors.gold} /> : null}
        </View>
        {district ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MapPin size={13} color={colors.mutedForeground} />
            <Text variant="small" tone="mutedForeground">
              {district}
            </Text>
          </View>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[1],
          paddingHorizontal: space[3],
          paddingVertical: space[1],
          ...corner('full'),
          backgroundColor: colors.secondary,
        }}
      >
        <Briefcase size={14} color={colors.primary} />
        <Text variant="small" weight="semibold" tone="primary">
          {formatNumber(openRoles, locale)}
        </Text>
      </View>
    </Card>
  );
}
