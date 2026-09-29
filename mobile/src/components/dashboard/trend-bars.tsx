import { View } from 'react-native';
import { useLocale } from 'use-intl';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

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
 * A month of one daily count — the website's TrendChart, as a bar per day
 * (at phone width a bar reads better than a line). Oldest on the left, as the
 * website draws time whatever the language. A window of zeros says so rather
 * than drawing a flat nothing. VoiceOver hears the total, not thirty numbers.
 */
export function TrendBars({
  title,
  hint,
  days,
  values,
  empty,
  totalLabel,
}: {
  title: string;
  hint?: string;
  /** ISO dates, one per value, gaps already filled in by the database. */
  days: string[];
  values: number[];
  empty: string;
  /** Read out with the total. */
  totalLabel: string;
}) {
  const locale = useLocale();
  const { colors } = useTheme();
  const peak = Math.max(0, ...values);
  const max = niceCeiling(peak);
  const total = values.reduce((sum, value) => sum + value, 0);

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

      {peak === 0 ? (
        <Text variant="small" tone="mutedForeground" style={{ paddingVertical: space[6], textAlign: 'center' }}>
          {empty}
        </Text>
      ) : (
        <View accessible accessibilityLabel={`${totalLabel}: ${formatNumber(total, locale)}`} style={{ gap: space[1] }}>
          <View style={{ flexDirection: 'row', gap: space[2], direction: 'ltr' }}>
            <View style={{ justifyContent: 'space-between', height: 120 }}>
              <Text variant="caption" tone="mutedForeground">
                {formatNumber(max, locale)}
              </Text>
              <Text variant="caption" tone="mutedForeground">
                {formatNumber(0, locale)}
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                height: 120,
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: 2,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              {values.map((value, index) => (
                <View
                  key={days[index] ?? index}
                  style={{
                    flex: 1,
                    height: value > 0 ? Math.max(3, (value / max) * 120) : 0,
                    borderTopLeftRadius: 2,
                    borderTopRightRadius: 2,
                    backgroundColor: colors.primary,
                  }}
                />
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', direction: 'ltr' }}>
            <Text variant="caption" tone="mutedForeground">
              {days[0] ? formatDayMonth(days[0], locale) : ''}
            </Text>
            <Text variant="caption" tone="mutedForeground">
              {days.at(-1) ? formatDayMonth(days.at(-1) as string, locale) : ''}
            </Text>
          </View>
        </View>
      )}
    </Card>
  );
}
