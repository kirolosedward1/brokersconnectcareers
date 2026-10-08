import { useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { haptic } from '~/lib/haptics';
import { useReduceMotion } from '~/theme/reduce-motion';
import { corner, motion, space } from '~/theme/tokens';
import { Text } from './text';

export type SwipeAction = { label: string; icon: ReactNode; color: string; onPress: () => void };

/** How far the row opens to show an action, and how far a drag must go to leave it open. */
const OPEN = 104;
const HOLD = OPEN / 2;

/**
 * A row that slides aside to show an action under it, as Mail's rows do:
 * dragged right, the action at the left (`left`); dragged left, the one at
 * the right (`right`). Let go past halfway and it stays open on the action;
 * tap it to do it. Up-and-down drags stay the list's, so it still scrolls.
 *
 * The sides are the screen's, not the reading's: the caller puts each action
 * where its swipe reveals it. VoiceOver, which cannot swipe a row, gets both
 * as actions on the row itself.
 */
export function SwipeRow({ left, right, children }: { left?: SwipeAction; right?: SwipeAction; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const [x] = useState(() => new Animated.Value(0));
  // Where the row last came to rest, read by the drag as it moves (not state: no render per frame).
  const resting = useRef(0);
  const [shown, setShown] = useState<'left' | 'right' | null>(null);

  const settle = (to: number) => {
    resting.current = to;
    setShown(to > 0 ? 'left' : to < 0 ? 'right' : null);
    if (to !== 0) haptic.selection();
    Animated.timing(x, { toValue: to, duration: reduceMotion ? 0 : motion.fade, useNativeDriver: true }).start();
  };

  const bounds = { min: right ? -OPEN : 0, max: left ? OPEN : 0 };
  // The handlers run on touches, never while drawing: `resting` is read then.
  // eslint-disable-next-line react-hooks/refs
  const responder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderMove: (_, gesture) => {
      x.setValue(Math.max(bounds.min, Math.min(bounds.max, resting.current + gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      const end = resting.current + gesture.dx;
      settle(end >= HOLD && bounds.max > 0 ? OPEN : end <= -HOLD && bounds.min < 0 ? -OPEN : 0);
    },
    onPanResponderTerminate: () => settle(resting.current),
  });

  const run = (action: SwipeAction) => {
    settle(0);
    action.onPress();
  };

  const actions = [left ? { name: 'left', label: left.label } : null, right ? { name: 'right', label: right.label } : null].filter(
    (action): action is { name: string; label: string } => Boolean(action),
  );

  return (
    <View
      accessibilityActions={actions}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'left' && left) left.onPress();
        if (event.nativeEvent.actionName === 'right' && right) right.onPress();
      }}
    >
      <View style={[StyleSheet.absoluteFill, styles.under]} pointerEvents="box-none">
        {left ? <Action action={left} side="left" visible={shown === 'left'} onPress={() => run(left)} /> : <View />}
        {right ? <Action action={right} side="right" visible={shown === 'right'} onPress={() => run(right)} /> : <View />}
      </View>
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

function Action({ action, side, visible, onPress }: { action: SwipeAction; side: 'left' | 'right'; visible: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      // Hidden from VoiceOver: the row offers the same as an action of its own.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onPress={onPress}
      disabled={!visible}
      testID={`swipe-${side}`}
      style={{
        width: OPEN - space[2],
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1],
        ...corner('xl'),
        backgroundColor: action.color,
      }}
    >
      {action.icon}
      <Text variant="caption" weight="semibold" numberOfLines={2} style={{ color: '#FFFFFF', textAlign: 'center' }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Physical sides whichever way the app reads: the swipe that reveals each is physical too.
  under: { direction: 'ltr', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'stretch' },
});
