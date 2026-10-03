import { StyleSheet, View } from 'react-native';
import { haptic } from '~/lib/haptics';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { PressableScale } from './pressable-scale';
import { Select } from './select';
import { Text } from './text';

/**
 * One of a few, as iOS draws it: a recessed track with the chosen option
 * raised out of it. To VoiceOver, a labelled radio group of radio buttons,
 * each checked or not — the same thing the chips said before it.
 *
 * At the accessibility text sizes three options no longer fit side by side,
 * and a label cut short is a label not read; stacked, they filled the board's
 * first screen before a single result. There it is one row instead, naming
 * what is chosen ("sort by: newest"), that opens the options in a sheet —
 * what iOS itself does at those sizes, with a menu.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** What is being chosen, for VoiceOver ("sort by", "appearance"). */
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors, shadow } = useTheme();
  const large = useLargeText();

  if (large) {
    return (
      <Select
        label={label}
        value={value}
        options={options}
        placeholder={label}
        required
        inlineLabel
        onChange={(next) => {
          if (next === null || next === value) return;
          haptic.selection();
          onChange(next);
        }}
      />
    );
  }

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: 3,
        gap: 2,
        ...corner('full'),
        backgroundColor: colors.secondary,
      }}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            accessibilityLabel={option.label}
            onPress={() => {
              if (!checked) haptic.selection();
              onChange(option.value);
            }}
            // 36 points and the slop: the 44 a finger needs.
            hitSlop={{ top: 4, bottom: 4 }}
            scaleTo={0.96}
            style={{
              flexGrow: 1,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space[3],
              ...corner('full'),
              // The chosen one is edged as well as raised: its fill alone is
              // barely lighter than the track (1.2:1), the edge 3:1 against it.
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: checked ? colors.input : 'transparent',
              backgroundColor: checked ? colors.raised : 'transparent',
              boxShadow: checked ? shadow.card : undefined,
            }}
          >
            <Text
              variant="small"
              weight={checked ? 'semibold' : 'medium'}
              tone={checked ? 'foreground' : 'mutedForeground'}
              numberOfLines={1}
              style={{ textAlign: 'center' }}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
