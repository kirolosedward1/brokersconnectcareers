import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { useLaunchHeld, useLaunchReady } from '~/features/launch';
import { useReduceMotion } from '~/theme/reduce-motion';
import { motion, palette, space } from '~/theme/tokens';

/** The launch screen's own picture and size (app.config.ts, expo-splash-screen). */
const MARK = require('../../../assets/images/splash-icon.png');
const MARK_SIZE = 76;
/** The logo's Arabic wordmark (src/components/brand/brand-logo.tsx), at the foot of the page. */
const WORDMARK = require('../../../assets/brand/logo-wordmark-ar.png');
const WORDMARK_HEIGHT = 20;
const WORDMARK_WIDTH = (1375 / 286) * WORDMARK_HEIGHT;

/** When the app's code started: the mark breathes if the app is still getting ready long after. */
const STARTED_AT = Date.now();
/** How long the curtain takes to lift. */
const LIFT_MS = 420;
/** Past this with the app still getting ready, the mark breathes, so the page does not look stuck. */
const BREATHE_AFTER_MS = 1800;
/** How long Expo Go or the phone's own launch screen is given to come down, should the curtain never be laid out. */
const SPLASH_FALLBACK_MS = 1500;

/**
 * The app's opening: the logo mark alone at the middle of the page, the
 * wordmark small at its foot, as Instagram opens with its mark and "from
 * Meta". Drawn over everything from the app's first frame until the screen
 * the launch opens on is ready — and for a moment at least, so it is seen as
 * the app's opening rather than a flicker (src/features/launch.ts) — then it
 * lifts: the mark grows a little as the page fades through to the app (only
 * the fade, with Reduce Motion on).
 *
 * The phone's own launch screen draws the same mark at the same size in the
 * same place on the same colour (app.config.ts, expo-splash-screen), and is
 * taken down as soon as this is laid out over it, so one gives way to the
 * other without a change; only the wordmark arrives. In Expo Go, whose own
 * loading screen the app takes down the same way, this is what shows while
 * the app gets ready — under Expo Go's screen, the reader never saw it.
 *
 * A signed-out launch opens on the welcome, a full-screen sheet, which fades
 * in over the curtain instead (src/app/_layout.tsx), once it has been up its
 * moment.
 *
 * Drawn before the theme and the catalogue exist, so it takes neither: the
 * light page colour, as the launch screen has it whatever the phone's setting.
 * The marks are pictures of the name, not read by VoiceOver; nothing on the
 * page can be pressed until it has lifted.
 */
export function LaunchCurtain() {
  const ready = useLaunchReady();
  const held = useLaunchHeld();
  const reduceMotion = useReduceMotion();
  const [gone, setGone] = useState(false);
  const [lift] = useState(() => new Animated.Value(0));
  const [breath] = useState(() => new Animated.Value(0));
  const [footer] = useState(() => new Animated.Value(0));

  // Should it never be laid out, the phone's launch screen still comes down: never held for good.
  useEffect(() => {
    const timer = setTimeout(hideSplash, SPLASH_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  // The wordmark arrives under the mark the launch screen already showed.
  useEffect(() => {
    const animation = Animated.timing(footer, {
      toValue: 1,
      duration: motion.appear,
      delay: reduceMotion ? 0 : 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [footer, reduceMotion]);

  // A slow start: the mark breathes until the app is ready.
  useEffect(() => {
    if (ready || reduceMotion) return;
    let loop: Animated.CompositeAnimation | null = null;
    const timer = setTimeout(
      () => {
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(breath, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(breath, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        );
        loop.start();
      },
      Math.max(0, BREATHE_AFTER_MS - (Date.now() - STARTED_AT)),
    );
    return () => {
      clearTimeout(timer);
      loop?.stop();
    };
  }, [ready, reduceMotion, breath]);

  const lifts = ready && held;
  useEffect(() => {
    if (!lifts) return;
    breath.stopAnimation();
    const animation = Animated.timing(lift, {
      toValue: 1,
      duration: reduceMotion ? motion.fade : LIFT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setGone(true);
    });
    return () => animation.stop();
  }, [lifts, lift, breath, reduceMotion]);

  if (gone) return null;

  const pageShows = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  // The mark goes a beat ahead of the page, so the app is seen through it rather than behind it.
  const markShows = lift.interpolate({ inputRange: [0, 0.7], outputRange: [1, 0], extrapolate: 'clamp' });
  const markMoves = reduceMotion
    ? undefined
    : [
        { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
        { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) },
      ];

  return (
    <Animated.View
      testID="launch-screen"
      // Lifting, it lets the first taps through to the app.
      pointerEvents={lifts ? 'none' : 'auto'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={hideSplash}
      style={[styles.page, { opacity: pageShows }]}
    >
      <Animated.View testID="launch-mark" style={{ opacity: markShows, transform: markMoves }}>
        <Image source={MARK} style={{ width: MARK_SIZE, height: MARK_SIZE }} resizeMode="contain" />
      </Animated.View>
      <Animated.View style={[styles.foot, { opacity: Animated.multiply(footer, markShows) }]}>
        <Image source={WORDMARK} style={{ width: WORDMARK_WIDTH, height: WORDMARK_HEIGHT }} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

function hideSplash() {
  SplashScreen.hideAsync().catch(() => {});
}

const styles = StyleSheet.create({
  page: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.light.background,
  },
  // Above the home indicator, as Instagram's "from Meta" sits.
  foot: {
    position: 'absolute',
    bottom: (initialWindowMetrics?.insets.bottom ?? 0) + space[8],
    alignItems: 'center',
  },
});
