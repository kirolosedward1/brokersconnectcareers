import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import type { AgentFilters } from '@/lib/agent-filters';
import { formatNumber } from '@/lib/format';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import { DistrictChoices, FilterGroup, FilterSheetFrame } from '~/components/jobs/filter-sheet';
import { Chip } from '~/components/ui/chip';
import { clearSheetFilters, MIN_YEARS_STEPS, sheetFilterCount } from '~/features/directory/filters';
import { directorySearch, useDirectoryTotal } from '~/features/directory/queries';
import { toggled } from '~/features/jobs/filters';
import { markupTags } from '~/i18n/rich';

/**
 * The directory's filters — the website's AgentFilters rail, in its order and
 * its words: whether they are looking, a floor on experience, the tracks and
 * the districts. As on the board, the choices are a draft until applied, and
 * the button says how many consultants they come to.
 */
export function DirectoryFilterSheet({
  visible,
  filters,
  onClose,
  onApply,
}: {
  visible: boolean;
  filters: AgentFilters;
  onClose: () => void;
  onApply: (next: AgentFilters) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [draft, setDraft] = useState(filters);
  const [open, setOpen] = useState(visible);

  // Each time it opens, it starts from what the directory is showing.
  if (visible !== open) {
    setOpen(visible);
    if (visible) setDraft(filters);
  }

  const total = useDirectoryTotal(directorySearch(draft), visible);

  return (
    <FilterSheetFrame
      visible={visible}
      onClose={onClose}
      onClear={sheetFilterCount(draft) > 0 ? () => setDraft(clearSheetFilters(draft)) : null}
      applyLabel={
        total.data === undefined
          ? t('filters.showResults')
          : t.markup('jobs.showResultsCount', { count: formatNumber(total.data, locale), ...markupTags })
      }
      onApply={() => onApply(draft)}
    >
      <FilterGroup title={t('agents.availability')} single>
        <Chip label={t('filters.any')} radio selected={draft.availability === null} onPress={() => setDraft({ ...draft, availability: null })} />
        {AVAILABILITIES.map((value) => (
          <Chip
            key={value}
            label={t(`availability.${value}`)}
            radio
            selected={draft.availability === value}
            onPress={() => setDraft({ ...draft, availability: value })}
          />
        ))}
      </FilterGroup>

      {/* A floor, and labelled as one: search_agents() keeps everybody with at least this many years. */}
      <FilterGroup title={t('filters.experienceBand')} single>
        <Chip label={t('filters.any')} radio selected={draft.minYears === null} onPress={() => setDraft({ ...draft, minYears: null })} />
        {MIN_YEARS_STEPS.map((years) => (
          <Chip
            key={years}
            label={t('filters.minYears', { count: years })}
            radio
            selected={draft.minYears === years}
            onPress={() => setDraft({ ...draft, minYears: years })}
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

      <DistrictChoices
        selected={draft.districtSlugs}
        onToggle={(slug) => setDraft({ ...draft, districtSlugs: toggled(draft.districtSlugs, slug) })}
      />
    </FilterSheetFrame>
  );
}
