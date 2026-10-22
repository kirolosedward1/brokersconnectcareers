import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useReduceMotion } from '~/theme/reduce-motion';
import { useTheme } from '~/theme/provider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The ring's and the tick's lengths, for drawing them stroke by stroke. */
const RADIUS = 28;
const RING = 2 * Math.PI * RADIUS;
const TICK = 38;

/**
 * A tick that draws itself: the ring goes round, then the check is written
 * in it — the moment an application is sent. With Reduce Motion on it is
 * simply there.
 */
export function DrawnCheck({ size = 72, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const ink = color ?? colors.success;
  const [ring] = useState(() => new Animated.Value(reduceMotion ? 0 : RING));
  const [tick] = useState(() => new Animated.Value(reduceMotion ? 0 : TICK));

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.sequence([
      Animated.timing(ring, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
      Animated.timing(tick, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [ring, tick, reduceMotion]);

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={32} cy={32} r={RADIUS} fill={colors.card} />
      <AnimatedCircle
        cx={32}
        cy={32}
        r={RADIUS}
        fill="none"
        stroke={ink}
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeDasharray={`${RING} ${RING}`}
        strokeDashoffset={ring}
        // From the top, going round.
        transform="rotate(-90 32 32)"
      />
      <AnimatedPath
        d="M20 33 L28.5 41 L44.5 24.5"
        fill="none"
        stroke={ink}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${TICK} ${TICK}`}
        strokeDashoffset={tick}
      />
    </Svg>
  );
}

/** How many pieces, and how long they fly. */
const PIECES = 26;
const FLIGHT = 1300;

/** A piece's own way out, the same every time (no randomness while drawing). */
function course(index: number) {
  const angle = (index / PIECES) * Math.PI * 2 + (index % 3) * 0.35;
  const speed = 70 + ((index * 37) % 60);
  return {
    x: Math.cos(angle) * speed,
    // Up and out, then falling past where it started.
    rise: Math.sin(angle) * speed - 40,
    fall: 120 + ((index * 53) % 70),
    spin: (index % 2 ? 1 : -1) * (180 + ((index * 71) % 360)),
    wide: index % 3 === 0,
  };
}

/**
 * A burst of confetti in the brand's colours — gold, champagne, sapphire and
 * the cyan of the logo — from the point it is put at, once. Pointer-blind and
 * hidden from VoiceOver; nothing at all with Reduce Motion on.
 */
export function Confetti() {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const palette = [colors.gold, colors.champagne, colors.primary, colors.brandCyan, colors.success];

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: FLIGHT, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  if (reduceMotion) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 56, left: 0, right: 0, alignItems: 'center' }}
    >
      {Array.from({ length: PIECES }, (_, index) => {
        const way = course(index);
        return (
          <Animated.View
            key={index}
            style={{
              position: 'absolute',
              width: way.wide ? 10 : 6,
              height: way.wide ? 5 : 8,
              borderRadius: 1.5,
              backgroundColor: palette[index % palette.length],
              opacity: progress.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, way.x] }) },
                { translateY: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, way.rise, way.rise + way.fall] }) },
                { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${way.spin}deg`] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
