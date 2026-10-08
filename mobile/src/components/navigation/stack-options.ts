import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';
import { useTheme } from '~/theme/provider';
import { font } from '~/theme/tokens';

type StackOptions = NonNullable<ComponentProps<typeof Stack>['screenOptions']>;

/**
 * Every stack's header in the website's colours and type: the brand colour for
 * the back button, the title in IBM Plex, no hairline under the bar, and the
 * page background behind every screen. Used by each tab's stack and by the
 * sign-in sheet, so a pushed screen looks the same wherever it opens.
 *
 * No screen asks for iOS's large title. On iOS 26 a large title under a
 * painted bar is not drawn until the screen is scrolled (the tabs opened on an
 * empty band over their search field), and on a clear bar it is drawn
 * mirrored at the left edge whenever iOS itself runs left to right — in Expo
 * Go, and on any iPhone not set to Arabic — under the bar the app turns right
 * to left (src/lib/direction.ts). The bar's own title is drawn right from the
 * first frame (tests/screen-options.test.ts).
 */
export function useStackOptions(): Exclude<StackOptions, (...args: never[]) => unknown> {
  const { colors } = useTheme();
  return {
    headerTintColor: colors.primary,
    headerTitleStyle: { fontFamily: font.semibold, color: colors.foreground },
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.background },
    contentStyle: { backgroundColor: colors.background },
    // A page opened slides in whole, its bar with it, from the side the
    // reading starts on. iOS's own push slid the bar's titles one way and the
    // page the other under the app's right to left (src/lib/direction.ts), as
    // Expo Go creates its screen left to right; this one takes the direction
    // from the navigation controller the app turns (react-native-screens'
    // RNSScreenStackAnimator), with no slide of the bar's own.
    animation: 'simple_push',
    animationDuration: 350,
  };
}
