import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { appDirection } from '~/lib/direction';
import { useReduceMotion } from '~/theme/reduce-motion';
import { useTheme } from '~/theme/provider';
import { corner, motion } from '~/theme/tokens';

/**
 * How far through a flow the person is: a fill along a track, growing from
 * the side the reading starts on, that moves on to its new length when a step
 * is done — and back when they go back.
 *
 * The fill is the track's full length, slid back past the start edge, where
 * the track hides it, by the part not yet done: its leading end keeps its
 * round, and the slide runs on the native thread. A slide is physical, so
 * the reading direction decides which way is back — in Arabic, the right.
 *
 * To VoiceOver, a progress bar named by the step it is at ("step 2 of 4").
 */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [done] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const animation = Animated.timing(done, {
      toValue: Math.min(1, Math.max(0, value)),
      duration: reduceMotion ? 0 : motion.step + 160,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [done, value, reduceMotion]);

  const back = appDirection === 'rtl' ? width : -width;
  const translateX = done.interpolate({ inputRange: [0, 1], outputRange: [back, 0] });

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', height: 6, overflow: 'hidden', ...corner('full'), backgroundColor: colors.secondary }}
    >
      {/* Drawn once the track's length is known: before, there is nothing to slide. */}
      {width > 0 ? (
        <Animated.View
          style={{ width, height: '100%', ...corner('full'), backgroundColor: colors.primary, transform: [{ translateX }] }}
        />
      ) : null}
    </View>
  );
}
