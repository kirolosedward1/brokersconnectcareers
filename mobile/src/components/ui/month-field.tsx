import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { westernDigits } from '@/lib/search/arabic';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';
import { Button } from './button';
import { Calendar, X } from './lucide';
import { Text } from './text';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2024-03" read as its year and month (1 to 12); null for anything else. */
export function readMonth(value: string): { year: number; month: number } | null {
  const match = MONTH.exec(westernDigits(value).trim());
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

const names = new Map<string, string[]>();

/** The twelve months by name in the reader's language — يناير … ديسمبر — made once. */
export function monthNames(locale: string): string[] {
  let made = names.get(locale);
  if (!made) {
    // The website's own tags (src/lib/format.ts): Egypt's month names, Western digits.
    const format = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { month: 'long', timeZone: 'UTC' });
    made = Array.from({ length: 12 }, (_, index) => format.format(new Date(Date.UTC(2000, index, 15))));
    names.set(locale, made);
  }
  return made;
}

/** The years offered, newest first: far enough ahead for a certificate's expiry, back to the website's earliest. */
const FIRST_YEAR = 1950;
const YEARS_AHEAD = 10;
const ROW = hitTarget + 4;

/**
 * A year and a month, picked rather than typed — the website's
 * <input type="month">, as a phone does it. The field says the month in
 * words ("مارس 2024"); its sheet has the years in one column and the twelve
 * months beside them, so any month is two taps away. `clearLabel` offers to
 * leave it empty again, for a date that may be ("I still work there").
 *
 * The value is the form's own "2024-03", so what was saved before, and the
 * form's checks (dateOf in src/components/profile/fields.tsx), stay as they were.
 */
export function MonthField({
  label,
  value,
  onChange,
  clearLabel,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  clearLabel?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const months = monthNames(locale);
  const chosen = readMonth(value);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear + YEARS_AHEAD - FIRST_YEAR + 1 }, (_, index) => thisYear + YEARS_AHEAD - index);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(chosen?.year ?? thisYear);

  const shown = chosen ? `${months[chosen.month - 1]} ${chosen.year}` : value.trim() || null;

  const show = () => {
    setYear(chosen?.year ?? thisYear);
    setOpen(true);
  };
  const choose = (month: number) => {
    onChange(`${year}-${String(month).padStart(2, '0')}`);
    setOpen(false);
  };
  const clear = () => {
    onChange('');
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown ?? t('app.profile.monthChoose')}`}
        onPress={show}
        style={({ pressed }) => ({
          minHeight: hitTarget + 6,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[2],
          paddingHorizontal: space[4] - 2,
          ...corner('lg'),
          borderWidth: 1,
          borderColor: colors.input,
          backgroundColor: pressed ? colors.muted : colors.card,
        })}
      >
        <Text tone={shown ? 'foreground' : 'mutedForeground'} numberOfLines={1} style={{ flexShrink: 1 }}>
          {shown ?? t('app.profile.monthChoose')}
        </Text>
        <Calendar size={18} color={colors.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background, paddingBottom: insets.bottom + space[4] }}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text variant="headline" weight="semibold" accessibilityRole="header" style={{ flexShrink: 1 }}>
              {label}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={() => setOpen(false)}
              hitSlop={10}
              style={{ minWidth: hitTarget, minHeight: hitTarget, marginEnd: -(hitTarget - 20) / 2, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <View style={{ flex: 1, flexDirection: 'row', gap: space[4], paddingHorizontal: gutter, paddingTop: space[4] }}>
            {/* The years: the newest at the top, the one in the field brought into view. */}
            <View style={{ width: 96, gap: space[2] }}>
              <Text variant="small" weight="medium" tone="mutedForeground">
                {t('app.profile.monthYear')}
              </Text>
              <FlatList
                data={years}
                keyExtractor={(item) => String(item)}
                getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
                initialScrollIndex={Math.max(0, years.indexOf(year) - 2)}
                showsVerticalScrollIndicator={false}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('app.profile.monthYear')}
                renderItem={({ item }) => {
                  const on = item === year;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => setYear(item)}
                      style={({ pressed }) => [
                        styles.year,
                        { backgroundColor: on ? colors.primary : pressed ? colors.muted : 'transparent' },
                      ]}
                    >
                      <Text weight={on ? 'semibold' : 'regular'} style={{ color: on ? colors.primaryForeground : colors.foreground }}>
                        {String(item)}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>

            {/* The year's twelve months: picking one fills the field and closes the sheet. */}
            <View style={{ flex: 1, gap: space[2] }}>
              <Text variant="small" weight="medium" tone="mutedForeground">
                {t('app.profile.monthMonth')}
              </Text>
              <View accessibilityRole="radiogroup" accessibilityLabel={t('app.profile.monthMonth')} style={styles.months}>
                {months.map((name, index) => {
                  const on = chosen?.year === year && chosen.month === index + 1;
                  return (
                    <Pressable
                      key={name}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${name} ${year}`}
                      onPress={() => choose(index + 1)}
                      style={({ pressed }) => [
                        styles.month,
                        {
                          borderColor: on ? colors.primary : colors.border,
                          backgroundColor: on ? colors.primary : pressed ? colors.muted : colors.card,
                        },
                      ]}
                    >
                      <Text
                        variant="small"
                        weight={on ? 'semibold' : 'medium'}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                        style={{ color: on ? colors.primaryForeground : colors.foreground, textAlign: 'center' }}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {clearLabel ? (
            <View style={{ paddingHorizontal: gutter, paddingTop: space[3] }}>
              <Button label={clearLabel} variant="outline" onPress={clear} />
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  year: {
    height: ROW - space[1],
    marginBottom: space[1],
    alignItems: 'center',
    justifyContent: 'center',
    ...corner('full'),
  },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  month: {
    // Two to a row, the gap between them shared.
    width: '48%',
    flexGrow: 1,
    minHeight: hitTarget + 4,
    paddingHorizontal: space[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    ...corner('lg'),
  },
});
