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
 *
 * The button and the card are two parts (SortButton, SortSheet) so a screen
 * can keep the card where it is never redrawn: the board draws its header
 * afresh as its first listings arrive, and a card drawn inside it was torn
 * away under the reader's finger, the tap landing on a listing beneath.
 */
export function SortMenu<T extends string>(props: SortProps<T>) {
  const sheet = useSheet();
  return (
    <>
      <SortButton label={props.label} value={props.value} options={props.options} onPress={sheet.show} />
      <SortSheet sheet={sheet} {...props} />
    </>
  );
}

type SortProps<T extends string> = {
  /** What is chosen ("sort by"), for VoiceOver and the card's title. */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
};

/** The button: the order chosen, between the arrows that say it can be changed. */
export function SortButton<T extends string>({
  label,
  value,
  options,
  onPress,
}: Omit<SortProps<T>, 'onChange'> & { onPress: () => void }) {
  const { colors } = useTheme();
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${current.label}`}
      onPress={onPress}
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
  );
}

/**
 * The card of orders, opened by `sheet` (useSheet). A new order is applied
 * once the card has gone: it reloads the board, and a sheet asked for while
 * iOS was still fading this one out was never shown.
 */
export function SortSheet<T extends string>({ sheet, label, value, options, onChange }: SortProps<T> & { sheet: ReturnType<typeof useSheet> }) {
  const t = useTranslations('common');
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();

  const choose = (next: T) => {
    if (next === value) {
      sheet.hide();
      return;
    }
    haptic.selection();
    sheet.hide(() => onChange(next));
  };

  if (!sheet.mounted) return null;
  return (
    <Modal visible={sheet.open} transparent animationType="fade" onRequestClose={sheet.hide} onDismiss={sheet.onDismiss}>
      <View style={{ flex: 1, direction: appDirection, justifyContent: 'flex-end', backgroundColor: 'rgba(5, 10, 25, 0.45)' }}>
        {/* The shade beside the card, not around it, so VoiceOver reaches the orders in the card. */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={sheet.hide} style={StyleSheet.absoluteFill} />
        <View
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
        </View>
      </View>
    </Modal>
  );
}
