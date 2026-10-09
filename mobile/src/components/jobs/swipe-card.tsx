import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import type { LucideProps } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { haptic } from '~/lib/haptics';
import { useReduceMotion } from '~/theme/reduce-motion';
import { corner, gutter, space } from '~/theme/tokens';

export type SwipeWay = {
  label: string;
  icon: ComponentType<LucideProps>;
  /** The colour under the card, and the icon's on it. */
  ground: string;
  ink: string;
  /** The card slides away rather than back: what it was is leaving the list. */
  leaves?: boolean;
  onSwipe: () => void;
};

/** How far a card must travel before letting go does the thing. */
const COMMIT = 96;

/**
 * A card that is swiped to act on it, all the way, as Mail's rows are: dragged
 * right it does `right` (its colour and icon under the card, at the left,
 * grow as it goes), dragged left it does `left`. Past the mark the phone
 * ticks once; let go there and it is done — the card springs back, or slides
 * away when what it is leaves the list. Short of it, it springs back and
 * nothing happens. Up-and-down drags stay the list's, so it still scrolls.
 *
 * One drag, one gesture: nothing is drawn again while the finger moves (a
 * new responder per drawing would start the drag over from where it was).
 * The sides are the screen's, not the reading's. VoiceOver, which cannot
 * swipe a card, has the same as actions on the card itself.
 */
export function SwipeCard({ right, left, children }: { right?: SwipeWay; left?: SwipeWay; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const [x] = useState(() => new Animated.Value(0));
  // What the gesture reads as it runs: the latest ways, not those of the drawing it began in.
  const latest = useRef({ right, left, reduceMotion });
  useEffect(() => {
    latest.current = { right, left, reduceMotion };
  });

  // Made once; its handlers run on touches, never while drawing, and read `latest` then.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    // Past the mark already in this drag: the tick is given once each way.
    let armed = false;
    const back = () => Animated.spring(x, { toValue: 0, friction: 7, tension: 70, useNativeDriver: true }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
      onPanResponderGrant: () => {
        armed = false;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) => {
        const ways = latest.current;
        const dx = (gesture.dx > 0 && !ways.right) || (gesture.dx < 0 && !ways.left) ? 0 : gesture.dx;
        x.setValue(dx);
        const past = Math.abs(dx) >= COMMIT;
        if (past !== armed) {
          armed = past;
          if (past) haptic.selection();
        }
      },
      onPanResponderRelease: (_, gesture) => {
        const ways = latest.current;
        const chosen = gesture.dx >= COMMIT ? ways.right : gesture.dx <= -COMMIT ? ways.left : undefined;
        if (!chosen) return back();
        if (chosen.leaves && !ways.reduceMotion) {
          const width = Dimensions.get('window').width;
          Animated.timing(x, { toValue: Math.sign(gesture.dx) * width, duration: 220, useNativeDriver: true }).start(() => {
            chosen.onSwipe();
            // Still here a moment later (a list that keeps it): back in place.
            setTimeout(() => x.setValue(0), 400);
          });
          return;
        }
        back();
        chosen.onSwipe();
      },
      onPanResponderTerminate: back,
    });
  });

  return (
    <View>
      {right ? <Under way={right} side="left" x={x} /> : null}
      {left ? <Under way={left} side="right" x={x} /> : null}
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

/** What a swipe shows under the card on the side it uncovers, growing as the card goes. */
function Under({ way, side, x }: { way: SwipeWay; side: 'left' | 'right'; x: Animated.Value }) {
  const sign = side === 'left' ? 1 : -1;
  const reach = x.interpolate({
    inputRange: sign > 0 ? [0, COMMIT] : [-COMMIT, 0],
    outputRange: sign > 0 ? [0, 1] : [1, 0],
    extrapolate: 'clamp',
  });
  const grow = x.interpolate({
    inputRange: sign > 0 ? [0, COMMIT, COMMIT * 1.4] : [-COMMIT * 1.4, -COMMIT, 0],
    outputRange: sign > 0 ? [0.6, 1, 1.25] : [1.25, 1, 0.6],
    extrapolate: 'clamp',
  });
  const Icon = way.icon;
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, styles.under, { justifyContent: side === 'left' ? 'flex-start' : 'flex-end', backgroundColor: way.ground, opacity: reach }]}
    >
      <Animated.View style={{ alignItems: 'center', gap: space[1], transform: [{ scale: grow }] }}>
        <Icon size={24} color={way.ink} strokeWidth={2.25} />
        <Text variant="caption" weight="bold" style={{ color: way.ink }}>
          {way.label}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Physical sides whichever way the app reads: the swipe that shows each is physical too.
  under: { direction: 'ltr', flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter, ...corner('xl') },
});

/** For tests: the distance that commits a swipe. */
export const SWIPE_COMMIT = COMMIT;
