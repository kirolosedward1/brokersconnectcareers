import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogo } from '~/components/brand/brand-logo';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { useTabBarSmall } from '~/features/tab-bar';
import { useTheme } from '~/theme/provider';
import { useReduceMotion } from '~/theme/reduce-motion';
import { gutter, motion, space } from '~/theme/tokens';

/** The header's height under the status bar: a little less than iOS's own bar. */
export const HOME_HEADER = 40;

/**
 * Home's frame: a header of its own — the website's logo at its start (in
 * Arabic, the right) and the bell at its end, slimmer than iOS's navigation
 * bar — over the page.
 *
 * The header is not fixed: as the reader scrolls down it slides away under
 * the status bar, the page rising into its place, and as they scroll back up
 * it comes back — when the tab bar grows smaller and whole again, on the same
 * signal (src/features/tab-bar.ts). Header and page move together on the
 * native thread, and the page reaches one header's height below the screen's
 * foot, under the tab bar's band, so nothing opens up there as they rise.
 * With Reduce Motion on the header stays.
 */
export function HomeFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const bell = useHeaderBell();
  const away = useTabBarSmall();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: away && !reduceMotion ? 1 : 0,
      duration: motion.bars,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [away, reduceMotion, progress]);

  const rise = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -HOME_HEADER] });

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
      <Animated.View testID="home-frame" style={[styles.frame, { transform: [{ translateY: rise }] }]}>
        <View testID="home-header" style={styles.header}>
          <BrandLogo />
          {bell?.()}
        </View>
        <View style={styles.page}>{children}</View>
      </Animated.View>
      {/* The status bar's own band, over the header as it slides away. */}
      <View style={[styles.statusBand, { height: insets.top, backgroundColor: colors.background }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // A header's height taller than the screen: its foot is under the tab bar's band until the header slides away.
  frame: { flex: 1, marginBottom: -HOME_HEADER },
  page: { flex: 1 },
  header: {
    height: HOME_HEADER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingStart: gutter,
    paddingEnd: space[2],
  },
  statusBand: { position: 'absolute', top: 0, start: 0, end: 0 },
});
