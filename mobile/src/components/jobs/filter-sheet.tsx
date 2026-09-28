import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { X } from 'lucide-react-native';
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
import { boardQuery, clearSheetFilters, sheetFilterCount, toggled } from '~/features/jobs/filters';
import { useBoardTotal } from '~/features/jobs/queries';
import { useDistricts, useGovernorates } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';

/**
 * Every filter the website's /jobs panel has (src/components/jobs/job-filters.tsx),
 * in the same order and the same words: where the leads come from, a basic
 * salary and how much, the commission, when it was posted, the track, the kind
 * of company, experience, the contract, and the districts grouped by
 * governorate.
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
}: {
  visible: boolean;
  filters: JobFilters;
  onClose: () => void;
  onApply: (next: JobFilters) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);
  const [open, setOpen] = useState(visible);

  // Each time it opens, it starts from what the board is showing.
  if (visible !== open) {
    setOpen(visible);
    if (visible) setDraft(filters);
  }

  const query = boardQuery(draft);
  const total = useBoardTotal(query, visible);
  const count = sheetFilterCount(draft);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space[2],
            paddingHorizontal: space[4],
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
            style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={22} color={colors.foreground} />
          </Pressable>
          <Text weight="semibold" accessibilityRole="header">
            {t('jobs.filters')}
          </Text>
          <View style={{ minWidth: hitTarget, alignItems: 'flex-end' }}>
            {count > 0 ? (
              <Button label={t('jobs.clearFilters')} variant="ghost" size="sm" onPress={() => setDraft(clearSheetFilters(draft))} />
            ) : null}
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: space[4], gap: space[6] }}>
          <Group title={t('filters.leadsSource')}>
            {LEADS_SOURCES.map((value) => (
              <Chip
                key={value}
                label={t(`leadsSource.${value}`)}
                selected={draft.leadsSources.includes(value)}
                onPress={() => setDraft({ ...draft, leadsSources: toggled(draft.leadsSources, value) })}
              />
            ))}
          </Group>

          <Group title={t('filters.hasBasicSalary')} single>
            <Chip label={t('filters.any')} selected={draft.hasBasicSalary === null} onPress={() => setDraft({ ...draft, hasBasicSalary: null })} />
            <Chip
              label={t('filters.hasBasicSalaryYes')}
              selected={draft.hasBasicSalary === true}
              onPress={() => setDraft({ ...draft, hasBasicSalary: true })}
            />
            <Chip
              label={t('filters.hasBasicSalaryNo')}
              selected={draft.hasBasicSalary === false}
              onPress={() => setDraft({ ...draft, hasBasicSalary: false })}
            />
          </Group>

          <Group title={t('filters.minSalary')} single>
            <Chip label={t('filters.any')} selected={draft.minSalary === null} onPress={() => setDraft({ ...draft, minSalary: null })} />
            {MIN_SALARY_STEPS.map((value) => (
              <PayChip key={value} value={value} selected={draft.minSalary === value} onPress={() => setDraft({ ...draft, minSalary: value })} />
            ))}
          </Group>

          <Group title={t('filters.commissionType')}>
            {COMMISSION_TYPES.map((value) => (
              <Chip
                key={value}
                label={t(`commissionType.${value}`)}
                selected={draft.commissionTypes.includes(value)}
                onPress={() => setDraft({ ...draft, commissionTypes: toggled(draft.commissionTypes, value) })}
              />
            ))}
          </Group>

          <Group title={t('filters.posted')} single>
            <Chip label={t('filters.any')} selected={draft.postedWithin === null} onPress={() => setDraft({ ...draft, postedWithin: null })} />
            {POSTED_WITHIN_DAYS.map((days) => (
              <Chip
                key={days}
                label={t('filters.postedWithin', { days })}
                selected={draft.postedWithin === days}
                onPress={() => setDraft({ ...draft, postedWithin: days })}
              />
            ))}
          </Group>

          <Group title={t('filters.track')}>
            {JOB_TRACKS.map((value) => (
              <Chip
                key={value}
                label={t(`track.${value}`)}
                selected={draft.tracks.includes(value)}
                onPress={() => setDraft({ ...draft, tracks: toggled(draft.tracks, value) })}
              />
            ))}
          </Group>

          <Group title={t('filters.companyType')}>
            {COMPANY_TYPES.map((value) => (
              <Chip
                key={value}
                label={t(`companyType.${value}`)}
                selected={draft.companyTypes.includes(value)}
                onPress={() => setDraft({ ...draft, companyTypes: toggled(draft.companyTypes, value) })}
              />
            ))}
          </Group>

          <Group title={t('filters.experienceBand')}>
            {EXPERIENCE_BANDS.map((value) => (
              <Chip
                key={value}
                label={t(`experienceBand.${value}`)}
                selected={draft.experienceBands.includes(value)}
                onPress={() => setDraft({ ...draft, experienceBands: toggled(draft.experienceBands, value) })}
              />
            ))}
          </Group>

          <Group title={t('filters.employmentType')}>
            {EMPLOYMENT_TYPES.map((value) => (
              <Chip
                key={value}
                label={t(`employmentType.${value}`)}
                selected={draft.employmentTypes.includes(value)}
                onPress={() => setDraft({ ...draft, employmentTypes: toggled(draft.employmentTypes, value) })}
              />
            ))}
          </Group>

          <Districts
            selected={draft.districtSlugs}
            onToggle={(slug) => setDraft({ ...draft, districtSlugs: toggled(draft.districtSlugs, slug) })}
          />
        </ScrollView>

        <View
          style={{
            paddingHorizontal: space[4],
            paddingTop: space[3],
            paddingBottom: Math.max(insets.bottom, space[4]),
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Button
            label={
              total.data === undefined
                ? t('filters.showResults')
                : t.markup('jobs.showResultsCount', { count: formatNumber(total.data, locale), ...markupTags })
            }
            size="lg"
            onPress={() => onApply(draft)}
          />
        </View>
      </View>
    </Modal>
  );
}

function Group({ title, single = false, children }: { title: string; single?: boolean; children: ReactNode }) {
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
  return <Chip label={t('minSalaryAtLeast', { amount: formatNumber(value, locale) })} selected={selected} onPress={onPress} />;
}

/** The districts under their governorates, as the website groups them. */
function Districts({ selected, onToggle }: { selected: string[]; onToggle: (slug: string) => void }) {
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
