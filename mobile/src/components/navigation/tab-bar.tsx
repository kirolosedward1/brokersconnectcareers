import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import { Animated, Easing, StyleSheet, View, type ColorValue } from 'react-native';
import { Image } from 'expo-image';
import { CommonActions } from 'expo-router/react-navigation';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { trustedAvatarUrl } from '@/lib/avatar-url';
import type { LucideProps } from '~/components/ui/lucide';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { setTabBarSmall, useTabBarSmall } from '~/features/tab-bar';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { useReduceMotion } from '~/theme/reduce-motion';
import { corner, gutter, motion, space } from '~/theme/tokens';

/** The bar's height at rest: an icon over its name. */
const BAR = 56;
const ICON = 24;
const NAME = 16;
const GAP = 2;
/** Its size while a list scrolls down, against its own. */
const SMALL = 0.8;
/** The icons' size then, against their own: they shrink less than the bar does. */
const SMALL_ICON = 0.9;
/** How far the icons move down to the middle of the bar once the names have gone. */
const DROP = (GAP + NAME) / 2;
/** How far above its band the page fades into it. */
const FADE = 20;

/**
 * The tab bar: a capsule floating over the foot of the screen with every one
 * of the reader's tabs in it, each an icon over its name — the one open
 * filled, on a soft pill, in the primary colour.
 *
 * As a list scrolls down (useShrinkingTabBar, src/features/tab-bar.ts) it
 * grows smaller and the names go, leaving the icons, the way Instagram's bar
 * does; scrolling back up, reaching the top, or another screen coming into
 * view brings it back whole. Every tab stays in it, and keeps its name for
 * VoiceOver. It moves on the native thread, so a list busy drawing does not
 * stutter it; with Reduce Motion on it keeps its size and only the names fade.
 *
 * Its band is part of the layout, the screens ending above it, so no screen
 * needs room made under its last line; the band is the page's own colour, the
 * page fading into it rather than cut off at its edge, and the bar sits in it
 * as the website's floating cards do. Laid out in the app's direction: in
 * Arabic, Home is at the right.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors, shadow } = useTheme();
  const small = useTabBarSmall();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(small ? 1 : 0));

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: small ? 1 : 0,
      duration: reduceMotion ? motion.fade : motion.bars,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [small, reduceMotion, progress]);

  // Another screen in view — another tab, or one opened or closed in this
  // one — starts with the bar whole, wherever the last one left it.
  const inView = focusedKey(state);
  useEffect(() => {
    setTabBarSmall(false);
  }, [inView]);

  const barMoves = reduceMotion ? undefined : [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, SMALL] }) }];
  const iconMoves = reduceMotion
    ? undefined
    : [
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, DROP] }) },
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, SMALL_ICON / SMALL] }) },
      ];
  const nameShows = progress.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' });

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
        style={[
          styles.bar,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            boxShadow: shadow.raised,
            transform: barMoves,
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = index === state.index;
          const name = options.title ?? route.name;
          const tint = focused ? colors.primary : colors.mutedForeground;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.dispatch({ ...CommonActions.navigate(route), target: state.key });
            }
          };

          return (
            <PressableScale
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={name}
              // Names keep their size, as iOS's own tab bar's do; held, a
              // reader with large text sees the tab's name large instead.
              accessibilityShowsLargeContentViewer
              accessibilityLargeContentTitle={name}
              testID={`tab-${route.name}`}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={styles.tab}
            >
              {focused ? <View style={[styles.pill, { backgroundColor: colors.secondary }]} /> : null}
              <Animated.View style={{ transform: iconMoves }}>
                {options.tabBarIcon?.({ focused, color: tint, size: ICON })}
              </Animated.View>
              <Animated.View style={{ opacity: nameShows, transform: iconMoves ? [iconMoves[0]] : undefined }}>
                <Text
                  variant="label"
                  weight={focused ? 'semibold' : 'medium'}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  allowFontScaling={false}
                  style={{ color: tint, fontSize: 11, lineHeight: NAME, textAlign: 'center' }}
                >
                  {name}
                </Text>
              </Animated.View>
            </PressableScale>
          );
        })}
      </Animated.View>
    </View>
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

type NavigationLevel = { index?: number; routes: { key: string; state?: unknown }[] };

/** The screen in view, as the keys of the routes down to it: changes whenever another one is. */
function focusedKey(state: NavigationLevel): string {
  const keys: string[] = [];
  let level: NavigationLevel | undefined = state;
  while (level && typeof level.index === 'number' && level.routes[level.index]) {
    const route: NavigationLevel['routes'][number] = level.routes[level.index];
    keys.push(route.key);
    level = route.state as NavigationLevel | undefined;
  }
  return keys.join('>');
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
    padding: 3,
    ...corner('full'),
    borderWidth: StyleSheet.hairlineWidth,
    transformOrigin: 'bottom',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: GAP,
  },
  pill: {
    ...StyleSheet.absoluteFill,
    ...corner('full'),
  },
});
