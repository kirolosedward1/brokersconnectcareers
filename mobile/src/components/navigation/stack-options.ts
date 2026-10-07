import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';
import { liquidGlass } from '~/lib/liquid-glass';
import { useTheme } from '~/theme/provider';
import { font } from '~/theme/tokens';

type StackOptions = NonNullable<ComponentProps<typeof Stack>['screenOptions']>;

/**
 * Every stack's header in the website's colours and type: the brand colour for
 * the back button, the title in IBM Plex, no hairline under the bar, and the
 * page background behind every screen. Used by each tab's stack and by the
 * sign-in sheet, so a pushed screen looks the same wherever it opens.
 *
 * iOS 26 draws a large title only on a clear bar. Given a colour, the bar keeps
 * the title's room and leaves it empty until the screen is scrolled: the tabs'
 * first screens (Jobs, Companies, Account…) opened on a blank band over their
 * search field. There the bar's colour is left to React Navigation, which keeps
 * a large-title bar clear and paints every other bar the navigation theme's
 * `card` — the page background (src/app/_layout.tsx). Before iOS 26, and on
 * Android, the bar is painted here, as it always was.
 */
export function useStackOptions(): Exclude<StackOptions, (...args: never[]) => unknown> {
  const { colors } = useTheme();
  return {
    headerTintColor: colors.primary,
    headerTitleStyle: { fontFamily: font.semibold, color: colors.foreground },
    headerLargeTitleStyle: { fontFamily: font.bold, color: colors.foreground },
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    ...(liquidGlass() ? {} : { headerStyle: { backgroundColor: colors.background } }),
    contentStyle: { backgroundColor: colors.background },
  };
}
