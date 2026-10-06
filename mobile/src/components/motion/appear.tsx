import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { appDirection } from '~/lib/direction';
import { useReduceMotion } from '~/theme/reduce-motion';
import { motion } from '~/theme/tokens';

/**
 * Where something comes in from: rising from a little below, or sliding in
 * from the side the reading starts or ends on — in Arabic the right and the
 * left — or not moving at all, only fading in.
 */
export type AppearFrom = 'below' | 'start' | 'end' | 'none';

type Props = Omit<ViewProps, 'style'> & {
  children?: ReactNode;
  /** Waits this long first: a screen's parts arrive a beat apart (`motion.stagger`). */
  delay?: number;
  from?: AppearFrom;
  /** How far it travels, in points. */
  distance?: number;
  /** The size it starts at, growing to its own (0.9: nine tenths): a mark settling into place. */
  scale?: number;
  duration?: number;
  /** Held back until true: whatever happens under the splash screen is not seen. */
  play?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Its children, arriving: they fade in as they travel the last few points to
 * where they belong, on the native thread, so a screen still loading does not
 * stutter them. With Reduce Motion on they only fade, quickly, as iOS's own
 * screens do then.
 *
 * Only how it looks changes: the children are laid out, read by VoiceOver and
 * pressable from the first frame.
 */
export function Appear({
  children,
  delay = 0,
  from = 'below',
  distance = motion.appearDistance,
  scale,
  duration = motion.appear,
  play = true,
  style,
  ...props
}: Props) {
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!play) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? motion.fade : duration,
      delay: reduceMotion ? 0 : delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [play, progress, delay, duration, reduceMotion]);

  const travel = progress.interpolate({ inputRange: [0, 1], outputRange: [travelFrom(from, distance), 0] });
  const moves = [
    ...(from === 'below' ? [{ translateY: travel }] : from === 'none' ? [] : [{ translateX: travel }]),
    ...(scale === undefined ? [] : [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [scale, 1] }) }]),
  ];
  const transform = reduceMotion || moves.length === 0 ? undefined : moves;

  return (
    <Animated.View {...props} style={[style, { opacity: progress, transform }]}>
      {children}
    </Animated.View>
  );
}

/**
 * The offset something starts at. Transforms are physical — a positive
 * translateX is to the right whichever way the page reads — so the reading
 * direction decides the sign: in Arabic the start side is the right.
 */
export function travelFrom(from: AppearFrom, distance: number): number {
  if (from === 'below') return distance;
  if (from === 'none') return 0;
  const startIsRight = appDirection === 'rtl';
  const fromRight = from === 'start' ? startIsRight : !startIsRight;
  return fromRight ? distance : -distance;
}
