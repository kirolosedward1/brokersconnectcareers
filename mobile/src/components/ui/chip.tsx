import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { X } from '~/components/ui/lucide';
import { haptic } from '~/lib/haptics';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

/**
 * A small pressable capsule — the website's filter chips.
 *
 * `removable`: an active filter, tinted in the brand colour with a cross; the
 * whole chip is the target and says what pressing it does ("remove filter X").
 * `selected`: one choice of several, with the matching state, drawn solid.
 * Neither: a plain choice, like "without X (n)" on an empty board.
 * `radio`: one option of a single choice (the sort order, the appearance),
 * inside a labelled `radiogroup` — a radio button, checked when `selected`,
 * rather than a button that is selected.
 *
 * At least 36 points tall, with the slop taking the target to 44.
 */
export function Chip({
  label,
  onPress,
  removable = false,
  selected = false,
  radio = false,
  disabled = false,
  accessibilityLabel,
  icon,
}: {
  label: string;
  onPress: () => void;
  removable?: boolean;
  selected?: boolean;
  radio?: boolean;
  /** Not choosable now (a list at its limit), and said so to VoiceOver. */
  disabled?: boolean;
  accessibilityLabel?: string;
  icon?: ReactNode;
}) {
  const { colors } = useTheme();
  const solid = selected && !removable;
  const text = solid ? colors.primaryForeground : removable ? colors.primary : colors.foreground;

  return (
    <PressableScale
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityState={removable ? undefined : radio ? { checked: selected, disabled } : { selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => {
        // A choice clicks; dropping an active filter does not.
        if (!removable) haptic.selection();
        onPress();
      }}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : 1,
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1] + 2,
        paddingHorizontal: space[3] + 2,
        ...corner('full'),
        borderWidth: solid || removable ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: solid
          ? pressed
            ? colors.primaryPressed
            : colors.primary
          : removable
            ? colors.secondary
            : pressed
              ? colors.muted
              : colors.card,
      })}
    >
      {icon}
      <Text variant="small" weight={solid || removable ? 'semibold' : 'medium'} style={{ color: text }}>
        {label}
      </Text>
      {removable ? (
        <View accessible={false}>
          <X size={14} color={colors.primary} strokeWidth={2.5} />
        </View>
      ) : null}
    </PressableScale>
  );
}
