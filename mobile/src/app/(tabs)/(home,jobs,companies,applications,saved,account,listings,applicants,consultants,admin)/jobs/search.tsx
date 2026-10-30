import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { History, MapPin, Search, Target } from '~/components/ui/lucide';
import { EMPTY_FILTERS, type JobFilters } from '@/lib/job-filters';
import { formatEgp } from '@/lib/format';
import { localized } from '@/lib/locale';
import { canSaveJobs } from '@/lib/permissions';
import { SearchSuggestions } from '~/components/jobs/filter-sheet';
import { Chip } from '~/components/ui/chip';
import { ForwardChevron } from '~/components/ui/icons';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { filtersToParams } from '~/features/jobs/filters';
import { useListOwner } from '~/features/jobs/recent';
import { recentSearches, rememberSearch } from '~/features/jobs/recent-searches';
import { useDidYouMean, withSuggestion, MIN_LETTERS, typedLetters } from '~/features/jobs/suggestions';
import { useAgentProfile } from '~/features/profile/queries';
import { useDistricts } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/** The pay the design offers a chip for, one of the board's MIN_SALARY_STEPS. */
const PAY_FLOOR = 10000;

/**
 * Search, on a screen of its own (v1.1, the Search board) — opened from
 * Home's field: the words typed, and what they could mean before they are
 * searched for.
 *
 * Before anything is typed, the quick ways in — the place on the reader's
 * own profile ("near me", by the districts they work in: the app does not
 * ask where the phone is), the company bringing the clients, a basic of
 * 10,000 or more — and the searches made lately on this phone. As letters
 * are typed, «هل تقصد» a track and a place when two of the words name them
 * («اوفبلان تجمع» is «بيع أوف بلان · التجمع الخامس»), then the places,
 * tracks, titles and companies the words name, matched the way the website
 * reads Arabic and English (features/jobs/suggestions.ts). Searched, the
 * board opens with it; the board says when it found nothing, and offers to
 * keep the search as an alert or to look in any place.
 */
export default function SearchScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const owner = useListOwner();
  const { actor } = useSession();
  const [typed, setTyped] = useState('');
  const recent = recentSearches.useItems(owner);
  const districts = useDistricts().data ?? [];
  // The reader's own places, when they have a profile that names them (a candidate's read only).
  const profiled = useAgentProfile().data?.agent ?? null;
  const agent = canSaveJobs(actor) ? profiled : null;
  const home = districts.find((district) => district.id === agent?.district_ids?.[0]);
  const meant = useDidYouMean(typed);
  const typing = typedLetters(typed) >= MIN_LETTERS;
  const large = useLargeText();

  const open = (filters: JobFilters) => {
    haptic.selection();
    if (filters.q) rememberSearch(owner, filters.q);
    router.navigate({ pathname: '/jobs', params: filtersToParams(filters) });
  };
  const searchFor = (words: string) => {
    const q = words.trim().slice(0, 120);
    if (q) open({ ...EMPTY_FILTERS, q });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, title: t('app.search.title') }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: gutter, paddingVertical: space[2] }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={typed}
            onChangeText={setTyped}
            accessibilityLabel={t('app.search.title')}
            placeholder={t('app.search.placeholder')}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => searchFor(typed)}
            maxLength={120}
            autoCorrect={false}
          />
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} style={{ minHeight: hitTarget, justifyContent: 'center' }}>
          <Text variant="small" weight="medium" tone="primary">
            {t('common.cancel')}
          </Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: gutter, paddingTop: space[2], gap: space[5] }}>
        {typing ? (
          <>
            {meant ? (
              <View style={{ gap: space[2] }}>
                <Text variant="caption" tone="mutedForeground">
                  {t('app.search.didYouMean')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                  <Chip
                    label={meant.label}
                    icon={<Target size={14} color={colors.foreground} />}
                    onPress={() => open({ ...EMPTY_FILTERS, tracks: [meant.track], districtSlugs: [meant.slug] })}
                  />
                </View>
              </View>
            ) : null}
            <SearchSuggestions typed={typed} onPick={(suggestion) => open(withSuggestion({ ...EMPTY_FILTERS, q: typed.trim() }, suggestion))} />
            <Pressable
              accessibilityRole="button"
              onPress={() => searchFor(typed)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                minHeight: hitTarget,
                paddingHorizontal: space[3],
                ...corner('lg'),
                backgroundColor: pressed ? colors.muted : 'transparent',
              })}
            >
              <Search size={16} color={colors.primary} />
              <Text weight="medium" tone="primary" style={{ flex: 1 }}>
                {t('app.search.searchFor', { words: typed.trim() })}
              </Text>
              <ForwardChevron size={16} color={colors.primary} />
            </Pressable>
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {home ? (
                <Chip
                  label={t('app.search.nearMe', { place: localized(locale, home.name_ar, home.name_en) })}
                  icon={<MapPin size={14} color={colors.foreground} />}
                  onPress={() => open({ ...EMPTY_FILTERS, districtSlugs: [home.slug] })}
                />
              ) : null}
              <Chip label={t('leadsSource.company_provided_short')} onPress={() => open({ ...EMPTY_FILTERS, leadsSources: ['company_provided'] })} />
              <Chip
                label={t.markup('app.search.payFloor', { amount: formatEgp(PAY_FLOOR, locale), ...markupTags })}
                onPress={() => open({ ...EMPTY_FILTERS, minSalary: PAY_FLOOR })}
              />
            </View>

            {recent.length ? (
              <View style={{ gap: space[2] }}>
                <Text variant="small" weight="semibold" accessibilityRole="header">
                  {t('app.search.recent')}
                </Text>
                <View style={{ ...corner('xl'), borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' }}>
                  {recent.map((words, index) => (
                    <Pressable
                      key={words}
                      accessibilityRole="button"
                      accessibilityLabel={t('app.jobs.recentSearch', { words })}
                      onPress={() => searchFor(words)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space[3],
                        minHeight: hitTarget + 4,
                        paddingHorizontal: space[4],
                        borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
                        borderTopColor: colors.border,
                        backgroundColor: pressed ? colors.muted : 'transparent',
                      })}
                    >
                      <History size={16} color={colors.mutedForeground} />
                      <Text style={{ flex: 1 }} numberOfLines={large ? undefined : 1}>
                        {words}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
