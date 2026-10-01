import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { X } from '~/components/ui/lucide';
import { useTheme } from '~/theme/provider';
import { radius, space } from '~/theme/tokens';
import { Text } from './text';

/**
 * A small pressable token — the website's filter chips.
 *
 * `removable`: an active filter, tinted in the brand colour with a cross; the
 * whole chip is the target and says what pressing it does ("remove filter X").
 * `selected`: one choice of several, with the matching state.
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
  const tinted = removable || selected;

  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityState={removable ? undefined : radio ? { checked: selected, disabled } : { selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : 1,
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: tinted ? colors.primary : colors.border,
        backgroundColor: pressed ? colors.muted : tinted ? colors.secondary : colors.card,
      })}
    >
      {icon}
      <Text variant="small" weight="medium" style={{ color: tinted ? colors.primary : colors.foreground }}>
        {label}
      </Text>
      {removable ? (
        <View accessible={false}>
          <X size={14} color={colors.primary} />
        </View>
      ) : null}
    </Pressable>
  );
}
