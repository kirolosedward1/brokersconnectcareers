import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { History, Search, X } from '~/components/ui/lucide';
import { formatNumber } from '@/lib/format';
import type { JobFilters } from '@/lib/job-filters';
import { localized } from '@/lib/locale';
import {
  COMMISSION_TYPES,
  COMPANY_TYPES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
  MIN_SALARY_STEPS,
  POSTED_WITHIN_DAYS,
} from '@/lib/taxonomy';
import type { DistrictRow } from '@/lib/supabase/database.types';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { boardQuery, clearSheetFilters, sheetFilterCount, toggled } from '~/features/jobs/filters';
import { useBoardTotal } from '~/features/jobs/queries';
import { useListOwner } from '~/features/jobs/recent';
import { recentSearches } from '~/features/jobs/recent-searches';
import { useDistricts, useGovernorates } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { haptic } from '~/lib/haptics';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';

/**
 * Every filter the website's /jobs panel has (src/components/jobs/job-filters.tsx),
 * in the same order and the same words: the words to search for, where the
 * leads come from, a basic salary and how much, the commission, when it was
 * posted, the track, the kind of company, experience, the contract, and the
 * districts grouped by governorate.
 *
 * On the website each tick reloads the board beside the panel. Here the board
 * is under the sheet, so the choices are kept as a draft and the button says
 * how many listings they come to — asked of the same endpoint as the reader
 * chooses — and applies them in one go, as one step Back can undo.
 */
export function FilterSheet({
  visible,
  filters,
  onClose,
  onApply,
  focusSearch = false,
}: {
  visible: boolean;
  filters: JobFilters;
  onClose: () => void;
  onApply: (next: JobFilters) => void;
  /** Opened to search (the Jobs tab pressed again at the top): the keyboard comes up in the words. */
  focusSearch?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const [draft, setDraft] = useState(filters);
  // The words as they are typed; counted once the typing stops, not per letter.
  const [words, setWords] = useState(filters.q);
  const [open, setOpen] = useState(visible);

  // Each time it opens, it starts from what the board is showing.
  if (visible !== open) {
    setOpen(visible);
    if (visible) {
      setDraft(filters);
      setWords(filters.q);
    }
  }

  const query = boardQuery(draft);
  const total = useBoardTotal(query, visible);
  const typed = { ...draft, q: searchWords(words) };
  const count = sheetFilterCount(typed);

  return (
    <FilterSheetFrame
      visible={visible}
      onClose={onClose}
      onClear={
        count > 0
          ? () => {
              setWords('');
              setDraft(clearSheetFilters(typed));
            }
          : null
      }
      applyLabel={
        total.data === undefined
          ? t('filters.showResults')
          : t.markup('jobs.showResultsCount', { count: formatNumber(total.data, locale), ...markupTags })
      }
      // What is typed counts even if the keyboard is still up.
      onApply={() => onApply(typed)}
    >
      <View style={{ gap: space[2] }}>
        <Text variant="small" weight="semibold" accessibilityRole="header">
          {t('filters.search')}
        </Text>
        <TextField
          value={words}
          autoFocus={focusSearch}
          onChangeText={setWords}
          onEndEditing={() => setDraft(typed)}
          placeholder={t('filters.searchPlaceholder')}
          accessibilityLabel={t('filters.search')}
          returnKeyType="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect={false}
          leading={<Search size={18} color={colors.mutedForeground} />}
        />
        {/* What was searched lately, a tap from searching it again — while nothing is typed. */}
        {words.trim() ? null : <RecentSearches onPick={(picked) => onApply({ ...typed, q: picked })} />}
      </View>

      <FilterGroup title={t('filters.leadsSource')}>
        {LEADS_SOURCES.map((value) => (
          <Chip
            key={value}
            label={t(`leadsSource.${value}`)}
            selected={draft.leadsSources.includes(value)}
            onPress={() => setDraft({ ...draft, leadsSources: toggled(draft.leadsSources, value) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('filters.hasBasicSalary')} single>
        <Chip label={t('filters.any')} radio selected={draft.hasBasicSalary === null} onPress={() => setDraft({ ...draft, hasBasicSalary: null })} />
        <Chip
          label={t('filters.hasBasicSalaryYes')}
          radio
          selected={draft.hasBasicSalary === true}
          onPress={() => setDraft({ ...draft, hasBasicSalary: true })}
        />
        <Chip
          label={t('filters.hasBasicSalaryNo')}
          radio
          selected={draft.hasBasicSalary === false}
          onPress={() => setDraft({ ...draft, hasBasicSalary: false })}
        />
      </FilterGroup>

      <FilterGroup title={t('filters.minSalary')} single>
        <Chip label={t('filters.any')} radio selected={draft.minSalary === null} onPress={() => setDraft({ ...draft, minSalary: null })} />
        {MIN_SALARY_STEPS.map((value) => (
          <PayChip key={value} value={value} selected={draft.minSalary === value} onPress={() => setDraft({ ...draft, minSalary: value })} />
        ))}
      </FilterGroup>

      <FilterGroup title={t('filters.commissionType')}>
        {COMMISSION_TYPES.map((value) => (
          <Chip
            key={value}
            label={t(`commissionType.${value}`)}
            selected={draft.commissionTypes.includes(value)}
            onPress={() => setDraft({ ...draft, commissionTypes: toggled(draft.commissionTypes, value) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('filters.posted')} single>
        <Chip label={t('filters.any')} radio selected={draft.postedWithin === null} onPress={() => setDraft({ ...draft, postedWithin: null })} />
        {POSTED_WITHIN_DAYS.map((days) => (
          <Chip
            key={days}
            label={t('filters.postedWithin', { days })}
            radio
            selected={draft.postedWithin === days}
            onPress={() => setDraft({ ...draft, postedWithin: days })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('filters.track')}>
        {JOB_TRACKS.map((value) => (
          <Chip
            key={value}
            label={t(`track.${value}`)}
            selected={draft.tracks.includes(value)}
            onPress={() => setDraft({ ...draft, tracks: toggled(draft.tracks, value) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('filters.companyType')}>
        {COMPANY_TYPES.map((value) => (
          <Chip
            key={value}
            label={t(`companyType.${value}`)}
            selected={draft.companyTypes.includes(value)}
            onPress={() => setDraft({ ...draft, companyTypes: toggled(draft.companyTypes, value) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('filters.experienceBand')}>
        {EXPERIENCE_BANDS.map((value) => (
          <Chip
            key={value}
            label={t(`experienceBand.${value}`)}
            selected={draft.experienceBands.includes(value)}
            onPress={() => setDraft({ ...draft, experienceBands: toggled(draft.experienceBands, value) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t('filters.employmentType')}>
        {EMPLOYMENT_TYPES.map((value) => (
          <Chip
            key={value}
            label={t(`employmentType.${value}`)}
            selected={draft.employmentTypes.includes(value)}
            onPress={() => setDraft({ ...draft, employmentTypes: toggled(draft.employmentTypes, value) })}
          />
        ))}
      </FilterGroup>

      <DistrictChoices
        selected={draft.districtSlugs}
        onToggle={(slug) => setDraft({ ...draft, districtSlugs: toggled(draft.districtSlugs, slug) })}
      />
    </FilterSheetFrame>
  );
}

/** The last few searches on this phone, newest first, each a tap from the board searched for it again. */
function RecentSearches({ onPick }: { onPick: (words: string) => void }) {
  const t = useTranslations('app.jobs');
  const { colors } = useTheme();
  const owner = useListOwner();
  const kept = recentSearches.useItems(owner);
  if (!kept.length) return null;
  return (
    <View style={{ gap: space[2], paddingTop: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <History size={14} color={colors.mutedForeground} />
          <Text variant="caption" tone="mutedForeground" accessibilityRole="header">
            {t('recentSearches')}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => recentSearches.clear(owner)} hitSlop={10}>
          <Text variant="caption" weight="semibold" tone="primary">
            {t('recentSearchesClear')}
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {kept.map((words) => (
          <Chip key={words} label={words} accessibilityLabel={t('recentSearch', { words })} onPress={() => onPick(words)} />
        ))}
      </View>
    </View>
  );
}

/** The words as the board searches them: trimmed, and no longer than the website lets them be. */
function searchWords(typed: string): string {
  return typed.trim().slice(0, 120);
}

/**
 * The sheet itself, shared by the board and the consultant directory: a close
 * button, the title, "clear" when there is something to clear; the groups;
 * and one button at the bottom that says what applying comes to.
 */
export function FilterSheetFrame({
  visible,
  onClose,
  onClear,
  applyLabel,
  onApply,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Null when nothing is chosen. */
  onClear: (() => void) | null;
  applyLabel: string;
  onApply: () => void;
  children: ReactNode;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space[2],
            paddingHorizontal: gutter,
            paddingVertical: space[2],
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            hitSlop={8}
            // The glyph, not its 44-point box, on the page's margin.
            style={{ minWidth: hitTarget, minHeight: hitTarget, marginStart: -(hitTarget - 22) / 2, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={22} color={colors.foreground} />
          </Pressable>
          {/* Wraps at the largest text sizes, rather than pushing Clear off the sheet. */}
          <Text weight="semibold" accessibilityRole="header" style={{ flexShrink: 1, textAlign: 'center' }}>
            {t('jobs.filters')}
          </Text>
          <View style={{ minWidth: hitTarget, alignItems: 'flex-end' }}>
            {onClear ? <Button label={t('jobs.clearFilters')} variant="ghost" size="sm" onPress={onClear} style={{ marginEnd: -space[4] }} /> : null}
          </View>
        </View>

        {/* A choice tapped while the keyboard is up is taken at the first tap. */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: gutter, gap: space[6] }}
        >
          {children}
        </ScrollView>

        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: space[3],
            paddingBottom: Math.max(insets.bottom, space[4]),
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Button
            label={applyLabel}
            size="lg"
            onPress={() => {
              haptic.tap();
              onApply();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

export function FilterGroup({ title, single = false, children }: { title: string; single?: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="small" weight="semibold" accessibilityRole="header">
        {title}
      </Text>
      <View
        accessibilityRole={single ? 'radiogroup' : undefined}
        accessibilityLabel={title}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}
      >
        {children}
      </View>
    </View>
  );
}

function PayChip({ value, selected, onPress }: { value: number; selected: boolean; onPress: () => void }) {
  const t = useTranslations('filters');
  const locale = useLocale();
  return <Chip label={t('minSalaryAtLeast', { amount: formatNumber(value, locale) })} radio selected={selected} onPress={onPress} />;
}

/** The districts under their governorates, as the website groups them. */
export function DistrictChoices({ selected, onToggle }: { selected: string[]; onToggle: (slug: string) => void }) {
  const t = useTranslations('filters');
  const locale = useLocale();
  const districts = useDistricts();
  const governorates = useGovernorates();

  const byGovernorate = useMemo(() => {
    const groups = new Map<number, DistrictRow[]>();
    for (const district of districts.data ?? []) {
      const list = groups.get(district.governorate_id) ?? [];
      list.push(district);
      groups.set(district.governorate_id, list);
    }
    return groups;
  }, [districts.data]);

  return (
    <View style={{ gap: space[3] }}>
      <Text variant="small" weight="semibold" accessibilityRole="header">
        {t('district')}
      </Text>
      {(governorates.data ?? []).map((governorate) => {
        const group = byGovernorate.get(governorate.id) ?? [];
        if (!group.length) return null;
        const name = localized(locale, governorate.name_ar, governorate.name_en);
        return (
          <View key={governorate.id} style={{ gap: space[2] }}>
            <Text variant="caption" weight="medium" tone="mutedForeground">
              {name}
            </Text>
            <View accessibilityLabel={name} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {group.map((district) => (
                <Chip
                  key={district.id}
                  label={localized(locale, district.name_ar, district.name_en)}
                  selected={selected.includes(district.slug)}
                  onPress={() => onToggle(district.slug)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
