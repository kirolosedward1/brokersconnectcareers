import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Appear } from '~/components/motion/appear';
import { Button } from '~/components/ui/button';
import { Scale } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { COMPARE_MIN } from '~/features/saved/compare';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/**
 * The foot of Saved while listings are being chosen to compare: how many are
 * chosen of the three there is room for, Cancel, and "Compare (n)" — which
 * waits for the second. Above the tab bar, never over the last card: the
 * list ends where it begins.
 */
export function CompareBar({ count, onCompare, onCancel }: { count: number; onCompare: () => void; onCancel: () => void }) {
  const t = useTranslations('app.saved.compare');
  const tCommon = useTranslations('common');
  const { colors } = useTheme();
  const ready = count >= COMPARE_MIN;
  return (
    <Appear from="below" distance={24} duration={280}>
      <View
        style={{
          gap: space[2],
          paddingHorizontal: gutter,
          paddingTop: space[3],
          paddingBottom: space[2],
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <Text variant="small" tone="mutedForeground" accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
          {t.markup('picked', { count, ...markupTags })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Button label={tCommon('cancel')} variant="ghost" onPress={onCancel} />
          <View style={{ flex: 1 }}>
            <Button
              label={t.markup('go', { count, ...markupTags })}
              disabled={!ready}
              icon={<Scale size={18} color={colors.primaryForeground} />}
              onPress={onCompare}
              testID="compare-go"
            />
          </View>
        </View>
      </View>
    </Appear>
  );
}
