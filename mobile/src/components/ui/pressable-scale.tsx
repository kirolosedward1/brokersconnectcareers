import { forwardRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import { useReduceMotion } from '~/theme/reduce-motion';
import { motion } from '~/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: PressableStateCallbackType) => ReactNode);
  /** How far it settles while held: buttons a little, large cards less. */
  scaleTo?: number;
};

/**
 * Pressable, with the feel of a physical control: held, it settles slightly
 * into the page (on the native thread, so a busy screen does not stutter it),
 * and springs back when let go. With Reduce Motion on it does not move at all
 * and the pressed colour alone answers the finger.
 *
 * `style` and `children` take the pressed state as Pressable's do.
 */
export const PressableScale = forwardRef<View, Props>(function PressableScale(
  { style, children, scaleTo = motion.pressScale, onPressIn, onPressOut, ...props },
  ref,
) {
  const reduceMotion = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [pressed, setPressed] = useState(false);
  // What Pressable hands its own callbacks (Expo's web types add hover and focus).
  const state = { pressed, hovered: false, focused: false } as PressableStateCallbackType;

  const settle = (to: number, duration: number) => {
    Animated.timing(scale, {
      toValue: to,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      ref={ref}
      {...props}
      onPressIn={(event: GestureResponderEvent) => {
        setPressed(true);
        if (!reduceMotion) settle(scaleTo, motion.pressIn);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        setPressed(false);
        if (!reduceMotion) settle(1, motion.pressOut);
        onPressOut?.(event);
      }}
      style={[typeof style === 'function' ? style(state) : style, { transform: [{ scale }] }]}
    >
      {typeof children === 'function' ? children(state) : children}
    </AnimatedPressable>
  );
});
