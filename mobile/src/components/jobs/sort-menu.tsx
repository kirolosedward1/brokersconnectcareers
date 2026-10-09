import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { ArrowUpDown, Check, ChevronDown } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { appDirection } from '~/lib/direction';
import { haptic } from '~/lib/haptics';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/**
 * The board's order as one small button beside Filters — "↕ newest ⌄" — that
 * opens the three orders in a card at the foot of the screen, the chosen one
 * ticked. It took a whole row as a segmented control, over the listings.
 */
export function SortMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** What is chosen ("sort by"), for VoiceOver and the card's title. */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const t = useTranslations('common');
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const sheet = useSheet();
  const current = options.find((option) => option.value === value) ?? options[0];

  const choose = (next: T) => {
    sheet.hide();
    if (next === value) return;
    haptic.selection();
    onChange(next);
  };

  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current.label}`}
        onPress={sheet.show}
        hitSlop={4}
        style={({ pressed }) => ({
          minHeight: 40,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[1] + 2,
          paddingHorizontal: space[3],
          ...corner('full'),
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.muted : colors.card,
        })}
      >
        <ArrowUpDown size={15} color={colors.mutedForeground} />
        <Text variant="small" weight="semibold" numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {current.label}
        </Text>
        <ChevronDown size={15} color={colors.mutedForeground} />
      </PressableScale>

      {sheet.mounted ? (
        <Modal visible={sheet.open} transparent animationType="fade" onRequestClose={sheet.hide} onDismiss={sheet.onDismiss}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={sheet.hide}
            style={{ flex: 1, direction: appDirection, justifyContent: 'flex-end', backgroundColor: 'rgba(5, 10, 25, 0.45)' }}
          >
            {/* The card takes its own taps: only the shade around it closes it. */}
            <Pressable
              accessible={false}
              onPress={() => {}}
              style={{
                margin: space[3],
                marginBottom: Math.max(insets.bottom, space[3]),
                paddingVertical: space[2],
                ...corner('xxl'),
                backgroundColor: colors.card,
                boxShadow: shadow.raised,
              }}
            >
              <Text
                variant="small"
                weight="semibold"
                tone="mutedForeground"
                accessibilityRole="header"
                style={{ paddingHorizontal: gutter, paddingTop: space[2], paddingBottom: space[1] }}
              >
                {label}
              </Text>
              <View accessibilityRole="radiogroup" accessibilityLabel={label}>
                {options.map((option, index) => {
                  const chosen = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: chosen }}
                      accessibilityLabel={option.label}
                      onPress={() => choose(option.value)}
                      style={({ pressed }) => ({
                        minHeight: hitTarget + 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space[3],
                        paddingHorizontal: gutter,
                        borderTopWidth: index ? StyleSheet.hairlineWidth : 0,
                        borderTopColor: colors.border,
                        backgroundColor: pressed ? colors.muted : 'transparent',
                      })}
                    >
                      <Text weight={chosen ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                        {option.label}
                      </Text>
                      {chosen ? <Check size={20} color={colors.primary} strokeWidth={2.5} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}
