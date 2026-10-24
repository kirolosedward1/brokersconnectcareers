import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogo } from '~/components/brand/brand-logo';
import { useHeaderBell } from '~/components/notifications/header-bell';
import { useTheme } from '~/theme/provider';
import { gutter, space } from '~/theme/tokens';

/** The header's height under the status bar: a little less than iOS's own bar. */
export const HOME_HEADER = 40;

/**
 * Home's frame: a header of its own — the website's logo at its start (in
 * Arabic, the right) and the bell at its end, slimmer than iOS's navigation
 * bar — over the page.
 *
 * The header stays put as the page scrolls, as a navigation bar does. It used
 * to slide away under the status bar while the reader scrolled down, on the
 * same signal that made the tab bar smaller; the tab bar now keeps its size
 * and its names (src/features/tab-bar.ts), and the bell stays within reach
 * with it.
 */
export function HomeFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const bell = useHeaderBell();

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
      <View testID="home-frame" style={styles.frame}>
        <View testID="home-header" style={styles.header}>
          <BrandLogo />
          {bell?.()}
        </View>
        <View style={styles.page}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  page: { flex: 1 },
  header: {
    height: HOME_HEADER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingStart: gutter,
    paddingEnd: space[2],
  },
});
