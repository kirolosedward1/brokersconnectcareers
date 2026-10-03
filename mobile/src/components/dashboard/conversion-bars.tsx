import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { EmployerConversionRow } from '@/lib/supabase/database.types';
import { Card } from '~/components/ui/card';
import { ForwardChevron } from '~/components/ui/icons';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * How each live listing turns views into applications — the website's
 * ConversionBars. Bars are scaled against the best rate in the list, not a
 * hundred percent (two percent is a normal listing), and a listing nobody has
 * opened has no bar and a dash: no answer is not a zero.
 */
export function ConversionBars({ rows }: { rows: EmployerConversionRow[] }) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { colors } = useTheme();
  const n = (value: number) => formatNumber(value, locale);

  const rate = (row: EmployerConversionRow) => (row.views > 0 ? row.applications / row.views : null);
  const best = Math.max(0, ...rows.map((row) => rate(row) ?? 0));

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('conversionTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('conversionHint')}
        </Text>
      </View>

      {rows.length === 0 ? (
        <Text variant="small" tone="mutedForeground">
          {t('conversionEmpty')}
        </Text>
      ) : (
        rows.map((row) => {
          const value = rate(row);
          const width = value != null && best > 0 ? Math.max(4, (value / best) * 100) : 0;
          const title = localized(locale, row.title_ar, row.title_en);
          const percent = value == null ? '—' : `${n(Math.round(value * 1000) / 10)}%`;
          const counts = t('conversionCounts', { applications: n(row.applications), views: n(row.views) });
          return (
            <Pressable
              key={row.id}
              accessibilityRole="link"
              accessibilityLabel={`${title}: ${percent}، ${counts}`}
              onPress={() => router.navigate(`/employer/jobs/${row.id}/applicants` as never)}
              style={({ pressed }) => ({ gap: space[1], paddingVertical: space[1], opacity: pressed ? 0.7 : 1 })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[3] }}>
                <Text variant="small" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                  {title}
                </Text>
                <Text variant="small" weight="semibold">
                  {percent}
                </Text>
              </View>
              <View style={{ height: 8, ...corner('full'), backgroundColor: colors.muted, overflow: 'hidden' }}>
                <View style={{ width: `${width}%`, height: '100%', ...corner('full'), backgroundColor: colors.primary }} />
              </View>
              <Text variant="caption" tone="mutedForeground">
                {counts}
              </Text>
            </Pressable>
          );
        })
      )}

      <Pressable
        accessibilityRole="link"
        onPress={() => router.navigate('/employer/jobs' as never)}
        style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: space[1] }}
      >
        <Text variant="small" weight="medium" tone="primary">
          {t('conversionAll')}
        </Text>
        <ForwardChevron size={16} color={colors.primary} />
      </Pressable>
    </Card>
  );
}
