import { ScrollView, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { westernDigits } from '@/lib/search/arabic';
import { Chip } from '~/components/ui/chip';
import { Text } from '~/components/ui/text';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

/**
 * Pieces the profile's forms share: the website's CheckboxGroup as chips, and
 * the few things a phone keyboard needs read back — whole numbers typed with
 * either set of digits, and dates as a year and a month.
 */

export function ChipGroup<T extends string | number>({
  legend,
  options,
  selected,
  onToggle,
  scroll = false,
  max,
}: {
  legend: string;
  options: { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  /** A long list (districts, developers) in a box of its own height, as on the website. */
  scroll?: boolean;
  /**
   * The most the website's schema takes. Past it the save was refused with
   * nothing to say which list was too long; now the rest wait until one is
   * let go, and the limit is said under the list.
   */
  max?: number;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const full = max != null && selected.length >= max;
  const chips = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <Chip
            key={String(option.value)}
            label={option.label}
            selected={on}
            disabled={full && !on}
            onPress={() => onToggle(option.value)}
          />
        );
      })}
    </View>
  );

  return (
    <View style={{ gap: space[2] }} accessibilityLabel={legend}>
      <Text variant="small" weight="medium">
        {legend}
      </Text>
      {scroll ? (
        <View style={{ maxHeight: 224, ...corner('lg'), borderWidth: 1, borderColor: colors.border }}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space[3] }}>
            {chips}
          </ScrollView>
        </View>
      ) : (
        chips
      )}
      {max != null && (full || options.length > max) ? (
        <Text variant="caption" tone={full ? 'foreground' : 'mutedForeground'} accessibilityLiveRegion="polite">
          {t.markup('app.profile.chooseUpTo', { count: max, ...markupTags })}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A whole number as typed — Arabic-Indic or Western digits, with or without
 * thousands separators; null for nothing typed, NaN for something that is not
 * a number.
 */
export function wholeNumber(text: string): number | null {
  const digits = westernDigits(text).replace(/[\s,٬]/g, '');
  if (!digits) return null;
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A stored date as the year and month the form shows ("2024-03"). */
export function monthOf(date: string | null | undefined): string {
  return date ? date.slice(0, 7) : '';
}

/**
 * What the form's year-and-month field means as a date the actions accept:
 * null for nothing, the original date when its month was left alone (so an
 * edit never moves a day nobody touched), the month's first day when it
 * changed — and undefined for something that is not a year and a month.
 */
export function dateOf(month: string, original: string | null | undefined): string | null | undefined {
  const value = westernDigits(month).trim().replace(/[/.]/g, '-');
  if (!value) return null;
  if (!MONTH.test(value)) return undefined;
  if (original && original.startsWith(value)) return original;
  return `${value}-01`;
}
