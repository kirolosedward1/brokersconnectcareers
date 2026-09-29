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
 */
export function useStackOptions(): Exclude<StackOptions, (...args: never[]) => unknown> {
  const { colors } = useTheme();
  return {
    headerTintColor: colors.primary,
    headerTitleStyle: { fontFamily: font.semibold, color: colors.foreground },
    headerLargeTitleStyle: { fontFamily: font.bold, color: colors.foreground },
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.background },
    contentStyle: { backgroundColor: colors.background },
  };
}
