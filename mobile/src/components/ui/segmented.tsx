import { useWindowDimensions, View } from 'react-native';
import { haptic } from '~/lib/haptics';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

/**
 * One of a few, as iOS draws it: a recessed track with the chosen option
 * raised out of it. To VoiceOver, a labelled radio group of radio buttons,
 * each checked or not — the same thing the chips said before it.
 *
 * At the largest text sizes three options no longer fit side by side, and a
 * label cut short is a label not read: the options are stacked instead, each
 * as wide as the screen, and their words wrap.
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
  const stacked = useWindowDimensions().fontScale >= 1.4;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: stacked ? 'column' : 'row',
        padding: 3,
        gap: 2,
        ...corner(stacked ? 'xl' : 'full'),
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
            onPress={() => {
              if (!checked) haptic.selection();
              onChange(option.value);
            }}
            hitSlop={{ top: 4, bottom: 4 }}
            scaleTo={0.96}
            style={{
              flexGrow: 1,
              minHeight: 34,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space[3],
              paddingVertical: stacked ? space[2] : 0,
              ...corner(stacked ? 'lg' : 'full'),
              backgroundColor: checked ? colors.raised : 'transparent',
              boxShadow: checked ? shadow.card : undefined,
            }}
          >
            <Text
              variant="small"
              weight={checked ? 'semibold' : 'medium'}
              tone={checked ? 'foreground' : 'mutedForeground'}
              numberOfLines={stacked ? undefined : 1}
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
