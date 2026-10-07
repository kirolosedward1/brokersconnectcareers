import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';

/**
 * A mark that answers a tap: each time `trigger` moves on — the reader's own
 * tap saving a listing — it swells a little and settles, as iOS's own toggles
 * do. Never on its own: not on its first frame, not when the bookmarks are
 * read at launch, not when a list hands its row to another listing (key it by
 * what it marks, and it starts afresh there). Not with Reduce Motion on.
 *
 * Stopped part-way — a second tap, its row gone — it is put back at its own
 * size, never left swollen.
 */
export function Pop({ trigger, children, style }: { trigger: number; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const seen = useRef(trigger);

  useEffect(() => {
    if (trigger === seen.current) return;
    seen.current = trigger;
    if (reduceMotion) return;
    const animation = Animated.sequence([
      Animated.timing(scale, { toValue: 1.28, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      scale.setValue(1);
    };
  }, [trigger, scale, reduceMotion]);

  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}
