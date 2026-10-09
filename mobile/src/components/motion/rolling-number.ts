import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';

/**
 * A figure that rolls to its new value rather than jumping — a board's count
 * as the filters change, the week's numbers counting up as they arrive. The
 * first real figure is shown as it is (`null` while there is none yet, and
 * the last one is kept meanwhile, to roll on from). With Reduce Motion on it
 * simply changes.
 */
export function useRollingNumber(target: number | null, duration = 500): number | null {
  const reduceMotion = useReduceMotion();
  const [value] = useState(() => new Animated.Value(target ?? 0));
  const [shown, setShown] = useState<number | null>(target);
  const started = useRef(target !== null);

  useEffect(() => {
    const id = value.addListener(({ value: now }) => setShown(Math.round(now)));
    return () => value.removeListener(id);
  }, [value]);

  useEffect(() => {
    if (target === null) return;
    if (!started.current || reduceMotion) {
      started.current = true;
      value.setValue(target);
      return;
    }
    const animation = Animated.timing(value, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [value, target, reduceMotion, duration]);

  return shown;
}

/** From nothing up to its figure as it arrives, then rolling on from there: the week's numbers on Home. */
export function useCountUp(target: number, duration = 900): number {
  const reduceMotion = useReduceMotion();
  const [value] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = value.addListener(({ value: now }) => setShown(Math.round(now)));
    return () => value.removeListener(id);
  }, [value]);

  useEffect(() => {
    if (reduceMotion) {
      value.setValue(target);
      return;
    }
    const animation = Animated.timing(value, { toValue: target, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [value, target, reduceMotion, duration]);

  return shown;
}
