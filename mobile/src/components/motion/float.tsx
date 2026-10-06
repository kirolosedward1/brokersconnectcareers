import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';

/**
 * A slow drift up and back, for drawing that should feel alive without asking
 * to be looked at: a few points, over seconds, each drifter out of step with
 * the next (`phase`). On the native thread; still with Reduce Motion on, and
 * until `play`.
 *
 * A few drifts, then it rests. Drifting for ever kept the screen redrawing for
 * as long as it was open, and the iOS checks' Maestro, which waits for a screen
 * to settle before each step, crawled through the welcome for half an hour.
 */
export function Float({
  children,
  amplitude = 5,
  period = 4200,
  phase = 0,
  cycles = 2,
  play = true,
  style,
}: {
  children?: ReactNode;
  /** How far it drifts, in points. */
  amplitude?: number;
  /** One drift up and back, in milliseconds. */
  period?: number;
  /** How long it waits before its first drift, so drifters do not move as one. */
  phase?: number;
  /** How many drifts before it rests. */
  cycles?: number;
  play?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const [drift] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!play || reduceMotion) {
      drift.setValue(0);
      return;
    }
    const half = (toValue: number) =>
      Animated.timing(drift, { toValue, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
    const animation = Animated.sequence([
      Animated.delay(phase),
      Animated.loop(Animated.sequence([half(1), half(0)]), { iterations: cycles }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [play, reduceMotion, drift, period, phase, cycles]);

  const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -amplitude] });
  return <Animated.View style={[style, { transform: [{ translateY }] }]}>{children}</Animated.View>;
}
