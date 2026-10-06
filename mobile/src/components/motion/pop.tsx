import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';

/**
 * A mark that answers a change: when `on` turns on — a listing saved, a
 * company followed — it swells a little and settles, as iOS's own toggles
 * do. Not on the first frame (a listing saved last week is not news), not
 * when it turns off, and not with Reduce Motion on.
 */
export function Pop({ on, children, style }: { on: boolean; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const was = useRef(on);

  useEffect(() => {
    const turnedOn = on && !was.current;
    was.current = on;
    if (!turnedOn || reduceMotion) return;
    const animation = Animated.sequence([
      Animated.timing(scale, { toValue: 1.28, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [on, scale, reduceMotion]);

  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}
