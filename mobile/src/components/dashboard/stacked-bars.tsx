import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDayMonth } from '@/lib/format';
import { Card } from '~/components/ui/card';
import { Num } from '~/components/ui/num';
import { Segmented } from '~/components/ui/segmented';
import { Text } from '~/components/ui/text';
import { markupTags } from '~/i18n/rich';
import { haptic } from '~/lib/haptics';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

export type StackedSeries = { key: string; label: string; color: string; values: number[] };

const RANGES = [7, 30, 90] as const;
export type StackedRange = (typeof RANGES)[number];
const HEIGHT = 140;

/** A round number at or above the peak, so the axis reads — the website's rule. */
function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 4, 5, 6, 8]) {
    const candidate = step * power;
    if (candidate >= value) return candidate;
  }
  return 10 * power;
}

/**
 * Several daily counts as one stacked bar per day (the Admin board's platform
 * activity): the series in their given order from the floor up, each in its
 * colour with its total in the legend; a week, a month or a quarter; and a
 * tap on a day for what made it up. Oldest on the left, as the website draws
 * time whatever the language.
 *
 * VoiceOver hears the totals for the stretch shown, and can step through the
 * days (swipe up or down) to hear each one's figures.
 */
export function StackedBars({
  title,
  hint,
  days,
  series,
  empty,
  initialRange = 30,
}: {
  title: string;
  hint?: string;
  /** ISO dates, one per value, oldest first; the last `range` are drawn. */
  days: string[];
  series: StackedSeries[];
  empty: string;
  initialRange?: StackedRange;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const [range, setRange] = useState<StackedRange>(initialRange);
  const [picked, setPicked] = useState<number | null>(null);

  const count = Math.min(range, days.length);
  const shownDays = days.slice(-count);
  const shown = series.map((line) => ({ ...line, values: line.values.slice(-count) }));
  const totals = shownDays.map((_, index) => shown.reduce((sum, line) => sum + (line.values[index] ?? 0), 0));
  const peak = Math.max(0, ...totals);
  const max = niceCeiling(peak);
  const selected = picked != null && picked < shownDays.length ? picked : null;

  const describe = (index: number) =>
    [formatDayMonth(shownDays[index] as string, locale), ...shown.map((line) => `${line.label}: ${line.values[index] ?? 0}`)].join('، ');

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text weight="semibold" accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text variant="small" tone="mutedForeground">
            {hint}
          </Text>
        ) : null}
      </View>

      <Segmented
        label={title}
        options={RANGES.map((value) => ({ value: String(value) as `${StackedRange}`, label: t.markup(`app.chart.range${value}`, markupTags) }))}
        value={String(range) as `${StackedRange}`}
        onChange={(value) => {
          setRange(Number(value) as StackedRange);
          setPicked(null);
        }}
      />

      {/* The legend, each series with its total for the stretch shown. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        {shown.map((line) => (
          <View key={line.key} accessible style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <View style={{ width: 10, height: 10, ...corner('sm'), backgroundColor: line.color }} />
            <Text variant="caption" tone="mutedForeground">
              {line.label}
            </Text>
            <Num variant="caption" weight="semibold" value={line.values.reduce((sum, value) => sum + value, 0)} />
          </View>
        ))}
      </View>

      {peak === 0 ? (
        <Text variant="small" tone="mutedForeground" style={{ paddingVertical: space[6], textAlign: 'center' }}>
          {empty}
        </Text>
      ) : (
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={title}
          accessibilityValue={{ text: selected != null ? describe(selected) : shown.map((line) => `${line.label}: ${line.values.reduce((a, b) => a + b, 0)}`).join('، ') }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const last = shownDays.length - 1;
            const from = selected ?? (event.nativeEvent.actionName === 'increment' ? -1 : last + 1);
            setPicked(Math.max(0, Math.min(last, from + (event.nativeEvent.actionName === 'increment' ? 1 : -1))));
          }}
          style={{ gap: space[1] }}
        >
          {selected != null ? (
            <View
              testID="chart-tooltip"
              style={{ gap: 2, padding: space[2], ...corner('md'), backgroundColor: colors.muted, alignSelf: 'flex-start' }}
            >
              <Text variant="caption" weight="semibold">
                {formatDayMonth(shownDays[selected] as string, locale)}
              </Text>
              {shown.map((line) => (
                <View key={line.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
                  <View style={{ width: 8, height: 8, ...corner('full'), backgroundColor: line.color }} />
                  <Text variant="caption" tone="mutedForeground">
                    {line.label}
                  </Text>
                  <Num variant="caption" weight="semibold" value={line.values[selected] ?? 0} />
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space[2], direction: 'ltr' }}>
            <View style={{ justifyContent: 'space-between', height: HEIGHT }}>
              <Num variant="caption" tone="mutedForeground" value={max} />
              <Num variant="caption" tone="mutedForeground" value={0} />
            </View>
            <View
              style={{
                flex: 1,
                height: HEIGHT,
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: count > 30 ? 1 : 2,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              {shownDays.map((day, index) => (
                <Pressable
                  key={day}
                  testID="chart-day"
                  importantForAccessibility="no"
                  onPress={() => {
                    haptic.selection();
                    setPicked((current) => (current === index ? null : index));
                  }}
                  style={{ flex: 1, height: HEIGHT, justifyContent: 'flex-end', opacity: selected == null || selected === index ? 1 : 0.45 }}
                >
                  {/* From the floor up, in the series' order. */}
                  <View style={{ flexDirection: 'column-reverse' }}>
                    {shown.map((line) => {
                      const value = line.values[index] ?? 0;
                      return value > 0 ? (
                        <View key={line.key} style={{ height: Math.max(2, (value / max) * HEIGHT), backgroundColor: line.color }} />
                      ) : null;
                    })}
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', direction: 'ltr' }}>
            <Text variant="caption" tone="mutedForeground">
              {shownDays[0] ? formatDayMonth(shownDays[0], locale) : ''}
            </Text>
            <Text variant="caption" tone="mutedForeground">
              {shownDays.at(-1) ? formatDayMonth(shownDays.at(-1) as string, locale) : ''}
            </Text>
          </View>
        </View>
      )}
    </Card>
  );
}
