import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactElement } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type ColorValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useLocale } from 'use-intl';
import { trustedAvatarUrl } from '@/lib/avatar-url';
import { formatList, formatNumber } from '@/lib/format';
import { Appear } from '~/components/motion/appear';
import type { LucideProps } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { env } from '~/lib/env';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { useReduceMotion } from '~/theme/reduce-motion';
import { useReduceTransparency } from '~/theme/reduce-transparency';
import { corner, gutter, space } from '~/theme/tokens';

/** The bar's height at rest: an icon over its name. */
const BAR = 56;
/** Between the bar's edge and the tabs in it, all round. */
const INSET = 3;
const ICON = 24;
const NAME = 16;
const GAP = 2;
/** How far above its band the page fades into it. */
const FADE = 20;
/** How far a finger on the bar moves sideways before it is dragging the lens rather than pressing a tab. */
const DRAG = 8;

/**
 * The pill behind the open tab: the page's ink, faintly, on the light bar;
 * light, faintly, on the dark one — as iOS's own bar marks its open tab.
 */
const PILL = { light: 'rgba(22, 41, 90, 0.08)', dark: 'rgba(255, 255, 255, 0.13)' } as const;

/**
 * Whether this phone draws Liquid Glass: iOS 26 or later, with the API there
 * (some iOS 26 betas lacked it), in an app that has not opted out of it — in
 * Expo Go, Expo Go's own setting. Asked once; a phone without it, or without
 * the module, has the bar's solid surface instead.
 */
const GLASS = Platform.OS === 'ios' && glassAvailable();

function glassAvailable(): boolean {
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

type Slot = { x: number; width: number };
type Frame = { x: number; width: number };

/**
 * The tab bar: a capsule floating over the foot of the screen with every one
 * of the reader's tabs in it, each an icon over its name — the one open
 * filled, in the primary colour, on a pill.
 *
 * The bar is Liquid Glass where the phone draws it (iOS 26 and later, Reduce
 * Transparency off), as iOS's own bar is; elsewhere a solid capsule with a
 * hairline and a shadow. The pill is not drawn per tab but once, and moves:
 * opening another tab, it glides there on a spring, stretching a little on
 * the way and settling back, the way iOS 26's own selection does. A finger
 * drawn along the bar takes the pill with it as a lens — larger, the icon
 * under it larger too, a tick at each tab it crosses — and letting go opens
 * the tab it is over. With Reduce Motion on, the pill goes straight to its
 * tab and nothing stretches or swells.
 *
 * It stays whole however a list scrolls: every tab, each with its name, as
 * Apple asks of a tab bar (HIG, Tab bars: "Include tab labels") — no growing
 * smaller and dropping the names on the way down a list (src/features/tab-bar.ts).
 *
 * Its band is part of the layout, the screens ending above it, so no screen
 * needs room made under its last line; the band is the page's own colour, the
 * page fading into it rather than cut off at its edge, and the bar sits in it
 * as the website's floating cards do. Laid out in the app's direction: in
 * Arabic, Home is at the right.
 *
 * A tab can wear a count (`tabBarBadge`, as React Navigation's own bar takes
 * it): a small pill in the brand colour at the icon's top corner on the
 * reading side's end, "9+" past nine, gone at nought and while that tab is
 * the one open. VoiceOver hears it in the tab's name — the screen's own words
 * for the count when it gives them (`tabBarAccessibilityLabel`), the name and
 * the number otherwise.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors, scheme, shadow } = useTheme();
  const locale = useLocale();
  const reduceMotion = useReduceMotion();
  const reduceTransparency = useReduceTransparency();
  const glass = GLASS && !reduceTransparency;

  // Where the bar and each of its tabs are, as laid out: where the pill goes.
  // The tabs are known by their names, not their routes' keys: a tab not yet
  // opened is a stand-in route whose key is its name, and opening it gives it
  // a key of its own, which would make its button a new one, unmeasured.
  const [bar, setBar] = useState<Frame | null>(null);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const placeTab = (name: string, { nativeEvent: { layout } }: LayoutChangeEvent) => {
    setSlots((known) => {
      const was = known[name];
      if (was && was.x === layout.x && was.width === layout.width) return known;
      return { ...known, [name]: { x: layout.x, width: layout.width } };
    });
  };

  const openName = state.routes[state.index]?.name;
  const open = openName ? slots[openName] : undefined;
  const pill = usePill(open, reduceMotion);

  // The tab under a finger drawing the lens along the bar, while it does.
  const [lensed, setLensed] = useState<string | null>(null);

  const openTab = (name: string) => {
    const route = state.routes.find((candidate) => candidate.name === name);
    if (!route) return;
    const focused = name === openName;
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigateToTab(route.key);
  };

  const scrub = useScrub({
    routes: state.routes,
    openName,
    slots,
    bar,
    pill,
    reduceMotion,
    onLens: setLensed,
    onChoose: openTab,
  });

  const width = open?.width ?? 0;

  return (
    <View
      style={{
        backgroundColor: colors.background,
        paddingHorizontal: gutter,
        paddingTop: space[2],
        paddingBottom: Math.max(insets.bottom - space[2], space[2]),
      }}
    >
      <View
        pointerEvents="none"
        style={[
          styles.fade,
          { experimental_backgroundImage: `linear-gradient(to bottom, ${clear(colors.background)}, ${colors.background})` },
        ]}
      />
      <Animated.View
        testID="tab-bar"
        accessibilityRole="tablist"
        onLayout={({ nativeEvent: { layout } }) => setBar({ x: layout.x, width: layout.width })}
        {...scrub.panHandlers}
        style={[
          styles.bar,
          glass ? styles.glassBar : { backgroundColor: colors.card },
          // Its edge and its shadow either way: on glass too, the capsule stands off the page.
          { borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, boxShadow: shadow.raised },
        ]}
      >
        {glass ? (
          <GlassView
            testID="tab-bar-glass"
            pointerEvents="none"
            glassEffectStyle="regular"
            colorScheme={scheme}
            style={[StyleSheet.absoluteFill, { borderRadius: BAR / 2 }]}
          />
        ) : null}
        {/* The pill, behind the tabs: laid out left to right whatever the reading, as the tabs' places are measured. */}
        {open ? (
          <View pointerEvents="none" style={styles.pillTrack}>
            <Animated.View
              testID="tab-pill"
              style={[
                styles.pill,
                {
                  width,
                  backgroundColor: PILL[scheme],
                  transform: [{ translateX: pill.x }, { scaleX: pill.scaleX }, { scaleY: pill.scaleY }],
                },
              ]}
            />
          </View>
        ) : null}
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          // A tab whose screens stay but whose button does not (Home, for an admin: (tabs)/_layout.tsx).
          if (StyleSheet.flatten(options.tabBarItemStyle)?.display === 'none') return null;
          const focused = index === state.index;
          const name = options.title ?? route.name;
          // A count says there is something to see over there: not on the tab already open.
          const badge = focused ? null : badgeText(options.tabBarBadge, locale);
          return (
            <TabButton
              key={route.name}
              name={name}
              label={badge ? (options.tabBarAccessibilityLabel ?? formatList([name, badge], locale)) : name}
              badge={badge}
              testID={`tab-${route.name}`}
              focused={focused}
              lensed={lensed === route.name}
              tint={focused || lensed === route.name ? colors.primary : colors.mutedForeground}
              icon={options.tabBarIcon}
              onLayout={(event) => placeTab(route.name, event)}
              onPress={() => openTab(route.name)}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </Animated.View>
    </View>
  );
}

type PillMotion = {
  x: Animated.Value;
  scaleX: Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition;
  scaleY: Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition;
  /** Swells it into the lens a finger draws along the bar, and back: at once with Reduce Motion on. */
  lens: (on: boolean, instant: boolean) => void;
  /** Back over the open tab, after a finger let go of it elsewhere or was taken off the bar: at once with Reduce Motion on. */
  settle: (instant: boolean) => void;
};

/**
 * The pill's motion: over the open tab from the first frame it can be, then
 * gliding to each tab opened after — a spring, stretched along the way and
 * settling round again — or, with Reduce Motion on, there at once.
 */
function usePill(open: Slot | undefined, reduceMotion: boolean): PillMotion {
  const [x] = useState(() => new Animated.Value(0));
  const [stretch] = useState(() => new Animated.Value(0));
  const [swell] = useState(() => new Animated.Value(0));
  // Where it was last sent: whether there is any way to go.
  const at = useRef<number | null>(null);
  const target = open?.x;

  // Before the frame is drawn: the pill's first frame is already over its tab, not at the bar's edge.
  useLayoutEffect(() => {
    if (target === undefined) return;
    const from = at.current;
    at.current = target;
    if (from === null || reduceMotion || Math.abs(from - target) < 1) {
      x.setValue(target);
      return;
    }
    stretch.setValue(0);
    // Apart: a finger taking the pill mid-glide stops its travel, and its stretch still settles round.
    const glide = Animated.parallel(
      [
        Animated.spring(x, { toValue: target, stiffness: 320, damping: 28, mass: 1, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(stretch, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(stretch, { toValue: 0, stiffness: 260, damping: 15, mass: 1, useNativeDriver: true }),
        ]),
      ],
      { stopTogether: false },
    );
    glide.start();
    return () => {
      glide.stop();
      stretch.setValue(0);
    };
  }, [target, reduceMotion, x, stretch]);

  const [motionOf] = useState(() => ({
    x,
    scaleX: Animated.add(
      stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }),
      swell.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] }),
    ),
    scaleY: Animated.add(
      stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }),
      swell.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }),
    ),
    lens: (on: boolean, instant: boolean) => {
      if (instant) {
        swell.setValue(on ? 1 : 0);
        return;
      }
      Animated.spring(swell, { toValue: on ? 1 : 0, stiffness: 380, damping: 26, mass: 1, useNativeDriver: true }).start();
    },
    settle: (instant: boolean) => {
      if (at.current === null) return;
      if (instant) {
        x.setValue(at.current);
        return;
      }
      Animated.spring(x, { toValue: at.current, stiffness: 320, damping: 28, mass: 1, useNativeDriver: true }).start();
    },
  }));
  return motionOf;
}

type ScrubOptions = {
  routes: BottomTabBarProps['state']['routes'];
  openName: string | undefined;
  slots: Record<string, Slot>;
  bar: Frame | null;
  pill: PillMotion;
  reduceMotion: boolean;
  onLens: (name: string | null) => void;
  onChoose: (name: string) => void;
};

/**
 * A finger drawn sideways along the bar: the pill follows it as a lens, the
 * tab under it shown so (`onLens`) with a tick at each new one, and letting go
 * chooses that tab (`onChoose`); taken off the bar, or let go over the tab
 * already open, the pill settles back. A finger that only presses a tab is
 * the tab's: the bar takes over once it has moved sideways, not before — and
 * a finger that slipped sideways without leaving the tab it came down on
 * still pressed that tab, the open one too (its list back to the top).
 *
 * Made once — its handlers run on touches, never while drawing, and read the
 * latest layout then — so a drawing during the drag does not start it over.
 */
function useScrub(options: ScrubOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => {
    let under: string | null = null;
    // The tab the finger came down on, and whether it has been over another since.
    let start: string | null = null;
    let strayed = false;

    /** Where a finger at `pageX` on the screen is along the bar, in the bar's own points. */
    const along = (pageX: number): number | null => {
      const { bar } = latest.current;
      if (!bar) return null;
      return pageX - bar.x;
    };

    /** The tab at a point along the bar, or the nearest at either end. */
    const tabAt = (x: number): { name: string; slot: Slot } | null => {
      const { routes, slots } = latest.current;
      let nearest: { name: string; slot: Slot; distance: number } | null = null;
      for (const route of routes) {
        const slot = slots[route.name];
        if (!slot) continue;
        const distance = x < slot.x ? slot.x - x : x > slot.x + slot.width ? x - slot.x - slot.width : 0;
        if (!nearest || distance < nearest.distance) nearest = { name: route.name, slot, distance };
      }
      return nearest;
    };

    const follow = (pageX: number) => {
      const x = along(pageX);
      if (x === null) return;
      const found = tabAt(x);
      if (!found) return;
      if (start !== null && found.name !== start) strayed = true;
      const { bar } = latest.current;
      const half = found.slot.width / 2;
      const max = (bar?.width ?? found.slot.x + found.slot.width + INSET) - INSET - found.slot.width;
      latest.current.pill.x.setValue(Math.min(Math.max(x - half, INSET), Math.max(max, INSET)));
      if (found.name !== under) {
        if (under !== null) haptic.selection();
        under = found.name;
        latest.current.onLens(found.name);
      }
    };

    const end = (choose: boolean) => {
      const { pill, openName, onLens, onChoose, reduceMotion } = latest.current;
      const chosen = choose ? under : null;
      const pressed = chosen !== null && chosen === start && !strayed;
      under = null;
      start = null;
      strayed = false;
      onLens(null);
      pill.lens(false, reduceMotion);
      if (chosen && (chosen !== openName || pressed)) onChoose(chosen);
      if (!chosen || chosen === openName) pill.settle(reduceMotion);
    };

    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dx) > DRAG && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: (event, gesture) => {
        under = null;
        strayed = false;
        const down = along(startOf(event) ?? gesture.x0);
        start = down === null ? null : (tabAt(down)?.name ?? null);
        // With Reduce Motion on the pill follows the finger as it is, without swelling.
        if (!latest.current.reduceMotion) latest.current.pill.lens(true, false);
        follow(gesture.moveX || gesture.x0);
      },
      onPanResponderMove: (_, gesture) => follow(gesture.moveX),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => end(true),
      onPanResponderTerminate: () => end(false),
    });
  });
  return responder;
}

/** Where the finger now on the bar first came down, on the screen. */
function startOf(event: GestureResponderEvent): number | null {
  // The responder system's record of the touches, which PanResponder reads too.
  const history = (event as GestureResponderEvent & { touchHistory?: { indexOfSingleActiveTouch: number; touchBank?: unknown[] } }).touchHistory;
  if (!history) return null;
  const touch = history.touchBank?.[history.indexOfSingleActiveTouch] as { startPageX?: number } | undefined;
  return typeof touch?.startPageX === 'number' ? touch.startPageX : null;
}

type TabButtonProps = {
  name: string;
  /** What VoiceOver reads: the name, with the count when there is one. */
  label: string;
  badge: string | null;
  testID: string;
  focused: boolean;
  lensed: boolean;
  tint: string;
  icon: BottomTabBarProps['descriptors'][string]['options']['tabBarIcon'];
  onLayout: (event: LayoutChangeEvent) => void;
  onPress: () => void;
  onLongPress: () => void;
};

/**
 * One tab: its icon over its name. Opened, the icon gives a small bounce, as
 * iOS's own tab icons do; under the lens a finger draws along the bar it grows
 * a little, as if seen through it. Neither with Reduce Motion on.
 */
function TabButton({ name, label, badge, testID, focused, lensed, tint, icon, onLayout, onPress, onLongPress }: TabButtonProps) {
  const reduceMotion = useReduceMotion();
  const [bump] = useState(() => new Animated.Value(0));
  const [magnify] = useState(() => new Animated.Value(0));
  const wasFocused = useRef(focused);

  useEffect(() => {
    const was = wasFocused.current;
    wasFocused.current = focused;
    if (!focused || was || reduceMotion) return;
    bump.setValue(0);
    const bounce = Animated.sequence([
      Animated.timing(bump, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(bump, { toValue: 0, stiffness: 420, damping: 12, mass: 1, useNativeDriver: true }),
    ]);
    bounce.start();
    return () => {
      bounce.stop();
      bump.setValue(0);
    };
  }, [focused, reduceMotion, bump]);

  useEffect(() => {
    const to = lensed && !reduceMotion ? 1 : 0;
    const swell = Animated.spring(magnify, { toValue: to, stiffness: 380, damping: 24, mass: 1, useNativeDriver: true });
    swell.start();
    return () => swell.stop();
  }, [lensed, reduceMotion, magnify]);

  const own = [
    { scale: bump.interpolate({ inputRange: [0, 1], outputRange: [1, 0.84] }) },
    { scale: magnify.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
  ];

  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      // Names keep their size, as iOS's own tab bar's do; held, a
      // reader with large text sees the tab's name large instead.
      accessibilityShowsLargeContentViewer
      accessibilityLargeContentTitle={name}
      testID={testID}
      onLayout={onLayout}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tab}
    >
      <Animated.View style={{ transform: own }}>
        {icon?.({ focused, color: tint, size: ICON })}
        {badge ? <TabBadge text={badge} /> : null}
      </Animated.View>
      <View>
        <Text
          variant="label"
          weight={focused ? 'semibold' : 'medium'}
          numberOfLines={1}
          allowFontScaling={false}
          style={{ color: tint, fontSize: 11, lineHeight: NAME, textAlign: 'center' }}
        >
          {name}
        </Text>
      </View>
    </PressableScale>
  );
}

/** What a badge says: a count up to nine, "9+" past it; nothing at nought or for nothing. */
export function badgeText(badge: number | string | undefined, locale: string): string | null {
  if (badge === undefined || badge === '') return null;
  if (typeof badge === 'string') return badge;
  if (!(badge > 0)) return null;
  return badge > 9 ? `${formatNumber(9, locale)}+` : formatNumber(badge, locale);
}

/**
 * The count on a tab: a pill in the brand colour, ringed in the bar's own so
 * it stands off the icon, settling into place as it first shows (only fading,
 * with Reduce Motion on). Its size stays put at every text size, as the
 * tabs' names do; the number is in the tab's name for VoiceOver.
 */
function TabBadge({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Appear from="none" scale={0.5} duration={240} pointerEvents="none" style={styles.badge}>
      <View testID="tab-badge" style={[styles.badgePill, { backgroundColor: colors.primary, borderColor: colors.card }]}>
        <Text weight="bold" allowFontScaling={false} style={{ color: colors.primaryForeground, fontSize: 11, lineHeight: 14, textAlign: 'center' }}>
          {text}
        </Text>
      </View>
    </Appear>
  );
}

/** A tab's icon: an SF Symbol on iOS, filled when the tab is open; elsewhere its Lucide stand-in. */
export function tabIcon(symbol: { default: SFSymbol; selected: SFSymbol }, Fallback: ComponentType<LucideProps>) {
  return function TabIcon({ focused, color, size }: TabIconProps) {
    return (
      <SymbolView
        name={focused ? symbol.selected : symbol.default}
        size={size}
        tintColor={color}
        weight={focused ? 'semibold' : 'regular'}
        fallback={
          <Fallback size={size} color={typeof color === 'string' ? color : undefined} strokeWidth={focused ? 2.25 : 1.75} />
        }
      />
    );
  };
}

/** A colour of the palette (#RRGGBB) with nothing of it showing: where a fade starts, without greying on its way. */
function clear(hex: string): string {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(rgb >> 16) & 255}, ${(rgb >> 8) & 255}, ${rgb & 255}, 0)`;
}

type TabIconProps = { focused: boolean; color: ColorValue; size: number };

/**
 * The Account tab's icon: the reader's own photo, round, when they have put
 * one on their account — ringed in the open tab's colour while it is open —
 * and otherwise the person's icon, as every other tab has.
 */
export function accountTabIcon(symbol: { default: SFSymbol; selected: SFSymbol }, Fallback: ComponentType<LucideProps>) {
  const Icon = tabIcon(symbol, Fallback);
  return function AccountTabIcon(props: TabIconProps) {
    return <OwnPhoto {...props} otherwise={<Icon {...props} />} />;
  };
}

function OwnPhoto({ focused, color, size, otherwise }: TabIconProps & { otherwise: ReactElement }) {
  const { viewer } = useSession();
  const photo = trustedAvatarUrl(viewer?.profile?.avatar_url, env.supabaseUrl);
  // Which photo failed, not whether one did: a new one is tried again.
  const [failed, setFailed] = useState<string | null>(null);
  if (!photo || failed === photo) return otherwise;
  const ring = 2;
  return (
    <View
      testID="tab-photo"
      style={{
        width: size + ring * 2,
        height: size + ring * 2,
        margin: -ring,
        padding: 1,
        borderRadius: size / 2 + ring,
        borderWidth: focused ? ring - 0.5 : 0,
        borderColor: focused ? color : 'transparent',
      }}
    >
      <Image
        source={{ uri: photo }}
        recyclingKey={photo}
        contentFit="cover"
        accessible={false}
        onError={() => setFailed(photo)}
        style={{ flex: 1, borderRadius: size / 2 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    top: -FADE,
    start: 0,
    end: 0,
    height: FADE,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: BAR,
    padding: INSET,
    ...corner('full'),
    transformOrigin: 'bottom',
  },
  // The glass is the surface: no colour of the bar's own over it.
  glassBar: {
    backgroundColor: 'transparent',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: GAP,
  },
  // Left to right whatever the reading: the tabs' measured places are the screen's, and so is the pill's.
  pillTrack: {
    ...StyleSheet.absoluteFill,
    direction: 'ltr',
  },
  pill: {
    position: 'absolute',
    top: INSET,
    left: 0,
    height: BAR - INSET * 2,
    borderRadius: (BAR - INSET * 2) / 2,
    borderCurve: 'continuous',
  },
  // Over the icon's top corner at the end of the reading: the left in Arabic, as iOS puts its own in a right-to-left bar.
  badge: {
    position: 'absolute',
    top: -6,
    end: -12,
  },
  badgePill: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    ...corner('full'),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
