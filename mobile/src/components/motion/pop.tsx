import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';

/**
 * A mark that answers a tap: each time `trigger` moves on — the reader's own
 * tap saving a listing — it swells a little and settles, as iOS's own toggles
 * do, and with `burst` a thin ring of that colour spreads from it and fades.
 * Never on its own: not on its first frame, not when the bookmarks are
 * read at launch, not when a list hands its row to another listing (key it by
 * what it marks, and it starts afresh there). Not with Reduce Motion on.
 *
 * Stopped part-way — a second tap, its row gone — it is put back at its own
 * size, never left swollen.
 */
export function Pop({
  trigger,
  children,
  style,
  burst,
}: {
  trigger: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  burst?: string;
}) {
  const reduceMotion = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [ring] = useState(() => new Animated.Value(0));
  const seen = useRef(trigger);

  useEffect(() => {
    if (trigger === seen.current) return;
    seen.current = trigger;
    if (reduceMotion) return;
    ring.setValue(0);
    const animation = Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.28, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
      ]),
      Animated.timing(ring, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      scale.setValue(1);
      ring.setValue(0);
    };
  }, [trigger, scale, ring, reduceMotion]);

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      {burst ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              borderWidth: 2,
              borderColor: burst,
              opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.9] }) }],
            }}
          />
        </View>
      ) : null}
      {children}
    </Animated.View>
  );
}
