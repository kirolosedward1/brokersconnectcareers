import { View } from 'react-native';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

/**
 * One of a few, as iOS draws it: a recessed track with the chosen option
 * raised out of it. To VoiceOver, a labelled radio group of radio buttons,
 * each checked or not — the same thing the chips said before it.
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
  const { colors, shadow, scheme } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        padding: 3,
        gap: 2,
        ...corner('full'),
        backgroundColor: scheme === 'dark' ? colors.card : colors.secondary,
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
            onPress={() => onChange(option.value)}
            hitSlop={{ top: 4, bottom: 4 }}
            scaleTo={0.96}
            style={{
              flexGrow: 1,
              minHeight: 34,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space[3],
              ...corner('full'),
              backgroundColor: checked ? colors.raised : 'transparent',
              boxShadow: checked ? shadow.card : undefined,
            }}
          >
            <Text
              variant="small"
              weight={checked ? 'semibold' : 'medium'}
              tone={checked ? 'foreground' : 'mutedForeground'}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
