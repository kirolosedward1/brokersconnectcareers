import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Check } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useReduceMotion } from '~/theme/reduce-motion';
import { useTheme } from '~/theme/provider';
import { motion, space } from '~/theme/tokens';

/** How long each line stays before the next rises into its place — the website's. */
export const TRUST_LINE_MS = 3600;
/** The line on its way out, quickly; the next rising the last few points into place. */
const OUT_MS = 160;
const RISE = 6;

/**
 * The hero's promises, one at a time: each rises into place as the one
 * before it has faded, every few seconds, round and round — the website's
 * TrustLines (src/components/home/trust-lines.tsx), the same lines in the
 * same order.
 *
 * Every line is laid out in the same place, the ones not showing invisible
 * rather than absent, so the row is as tall as the tallest line from the
 * start and nothing under it moves when a longer line's turn comes. With
 * Reduce Motion on they are all shown, still, as a list. VoiceOver reads the
 * whole list once, and is not told about the rotation.
 */
export function TrustLines({ lines }: { lines: string[] }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [showing, setShowing] = useState(0);
  const [progress] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion || lines.length < 2) return;
    let swap: Animated.CompositeAnimation | null = null;
    const timer = setInterval(() => {
      swap = Animated.timing(progress, { toValue: 0, duration: OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true });
      swap.start(({ finished }) => {
        if (!finished) return;
        setShowing((at) => (at + 1) % lines.length);
        swap = Animated.timing(progress, { toValue: 1, duration: motion.appear, easing: Easing.out(Easing.cubic), useNativeDriver: true });
        swap.start();
      });
    }, TRUST_LINE_MS);
    return () => {
      clearInterval(timer);
      swap?.stop();
      progress.setValue(1);
    };
  }, [reduceMotion, lines.length, progress]);

  const line = (text: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <Check size={16} color={colors.onHeroMuted} strokeWidth={2.5} />
      <Text variant="small" style={{ color: colors.onHeroMuted, flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );

  if (reduceMotion) {
    return <View style={{ gap: space[1] }}>{lines.map((text) => <View key={text}>{line(text)}</View>)}</View>;
  }

  return (
    <View accessible accessibilityLabel={lines.join('. ')}>
      {lines.map((text, index) => (
        <Animated.View
          key={text}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            index === 0 ? null : { position: 'absolute', top: 0, start: 0, end: 0 },
            index === showing
              ? {
                  opacity: progress,
                  transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) }],
                }
              : { opacity: 0 },
          ]}
          pointerEvents="none"
        >
          {line(text)}
        </Animated.View>
      ))}
    </View>
  );
}
