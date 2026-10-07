import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';

/**
 * Something on its way, breathing: its tone eases down and back while it
 * waits, so a placeholder reads as loading rather than as an empty card. Each
 * one a beat after the last (`phase`), the way a list fills from the top. On
 * the native thread; still with Reduce Motion on.
 */
export function Pulse({
  children,
  phase = 0,
  style,
}: {
  children?: ReactNode;
  phase?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const [tone] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      tone.setValue(1);
      return;
    }
    const ease = (toValue: number) =>
      Animated.timing(tone, { toValue, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const animation = Animated.sequence([Animated.delay(phase), Animated.loop(Animated.sequence([ease(0.55), ease(1)]))]);
    animation.start();
    return () => animation.stop();
  }, [tone, phase, reduceMotion]);

  return <Animated.View style={[style, { opacity: tone }]}>{children}</Animated.View>;
}
