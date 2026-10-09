import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, Pressable, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, type LucideProps } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { appDirection } from '~/lib/direction';
import { haptic } from '~/lib/haptics';
import { useReduceMotion } from '~/theme/reduce-motion';
import { useTheme } from '~/theme/provider';
import { corner, gutter, motion, space } from '~/theme/tokens';

export type ToastTone = 'default' | 'success';

export type Toast = {
  message: string;
  icon?: ComponentType<LucideProps>;
  tone?: ToastTone;
  /** One thing to do about it: "Undo", "View". */
  action?: { label: string; onPress: () => void };
};

type Shown = Toast & { id: number };

/** How long one stays: longer when it offers something to do. */
const STAY_MS = 3000;
const STAY_WITH_ACTION_MS = 4500;

let current: Shown | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * A word that something happened — "Saved", "Application withdrawn" — sliding
 * down from the top for a few seconds, with at most one thing to do about it
 * (Undo). A newer one takes the place of the last. Said to VoiceOver as well.
 */
export const toast = {
  show(next: Toast) {
    current = { ...next, id: nextId++ };
    emit();
    AccessibilityInfo.announceForAccessibility(next.action ? `${next.message}. ${next.action.label}` : next.message);
  },
  hide(id?: number) {
    if (!current || (id !== undefined && current.id !== id)) return;
    current = null;
    emit();
  },
};

/** For tests: what is showing, if anything. */
export function shownToast(): Shown | null {
  return current;
}

/**
 * Where they are drawn: once, at the root. On iOS over everything — a sheet,
 * a modal screen — in a window of its own, which takes taps only on the toast
 * itself; it is there only while one shows.
 */
export function ToastHost() {
  const shown = useSyncExternalStore(subscribe, () => current);
  if (!shown) return null;
  const card = <ToastCard key={shown.id} toast={shown} />;
  return Platform.OS === 'ios' ? <FullWindowOverlay>{card}</FullWindowOverlay> : card;
}

function ToastCard({ toast: shown }: { toast: Shown }) {
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  const Icon = shown.icon ?? CheckCircle2;
  const tint = shown.tone === 'success' || !shown.icon ? colors.success : colors.primary;

  const leave = () => {
    Animated.timing(progress, { toValue: 0, duration: reduceMotion ? 0 : motion.fade, useNativeDriver: true }).start(() =>
      toast.hide(shown.id),
    );
  };

  useEffect(() => {
    const arrive = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? motion.fade : 320,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    });
    arrive.start();
    const timer = setTimeout(leave, shown.action ? STAY_WITH_ACTION_MS : STAY_MS);
    return () => {
      arrive.stop();
      clearTimeout(timer);
    };
    // Once per toast: each one is its own card (keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pushed back up, it goes at once.
  const responder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy < -6,
    onPanResponderMove: (_, gesture) => drag.setValue(Math.min(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy < -24) leave();
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
    },
  });

  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : -(insets.top + 80), 0] }),
    drag,
  );

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + space[1], paddingHorizontal: gutter }}>
      <Animated.View
        {...responder.panHandlers}
        accessibilityLiveRegion="polite"
        testID="toast"
        style={{
          direction: appDirection,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          minHeight: 52,
          paddingStart: space[4],
          paddingEnd: shown.action ? space[1] : space[4],
          paddingVertical: space[2],
          ...corner('full'),
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          boxShadow: shadow.raised,
          opacity: progress,
          transform: [{ translateY }],
        }}
      >
        <Icon size={20} color={tint} strokeWidth={2.25} />
        <Text variant="small" weight="semibold" numberOfLines={2} style={{ flex: 1 }}>
          {shown.message}
        </Text>
        {shown.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown.action.label}
            hitSlop={6}
            onPress={() => {
              haptic.selection();
              shown.action?.onPress();
              leave();
            }}
            style={({ pressed }) => ({
              minHeight: 40,
              paddingHorizontal: space[4],
              justifyContent: 'center',
              ...corner('full'),
              backgroundColor: pressed ? colors.secondary : colors.muted,
            })}
          >
            <Text variant="small" weight="bold" tone="primary">
              {shown.action.label}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}
