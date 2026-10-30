import type { ComponentType } from 'react';
import { View } from 'react-native';
import type { LucideProps } from '~/components/ui/lucide';
import { Check } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { haptic } from '~/lib/haptics';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

/**
 * One answer among a few, as a card: its sign (when it has one), what it is,
 * what it means, and a mark at the end when it is chosen. To VoiceOver a
 * radio button — or, `multiple`, a checkbox, for a question that takes
 * several answers (the tracks somebody works in) — named by both lines.
 */
export function ChoiceCard({
  selected,
  onPress,
  icon: Icon,
  title,
  hint,
  multiple = false,
}: {
  selected: boolean;
  onPress: () => void;
  icon?: ComponentType<LucideProps>;
  title: string;
  hint?: string;
  multiple?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
      onPress={() => {
        if (!selected || multiple) haptic.selection();
        onPress();
      }}
      scaleTo={0.98}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: hint ? 'flex-start' : 'center',
        gap: space[3],
        padding: space[4],
        ...corner('xl'),
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: pressed ? colors.muted : selected ? colors.secondary : colors.card,
      })}
    >
      {Icon ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? colors.primary : colors.muted,
          }}
        >
          <Icon size={20} color={selected ? colors.primaryForeground : colors.mutedForeground} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: space[1] }}>
        <Text weight="semibold">{title}</Text>
        {hint ? (
          <Text variant="small" tone="mutedForeground">
            {hint}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          marginTop: hint ? 9 : 0,
          // A box for one of several, a circle for the one.
          ...(multiple ? corner('sm') : { borderRadius: 11 }),
          borderWidth: selected ? 0 : 1.5,
          borderColor: colors.input,
          backgroundColor: selected ? colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Check size={14} color={colors.primaryForeground} /> : null}
      </View>
    </PressableScale>
  );
}
