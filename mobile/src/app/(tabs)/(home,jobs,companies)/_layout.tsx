import { Stack } from 'expo-router';
import { useTheme } from '~/theme/provider';
import { font } from '~/theme/tokens';

/**
 * One stack per tab, shared by the three.
 *
 * A listing and a company page are reachable from every tab — the home feed,
 * the board, a company's own roles — so their screens live here, in the group
 * all three tabs expand from. Pushing /jobs/<slug> from the home tab stays in
 * the home tab, with Back to the home screen, rather than jumping to the board.
 *
 * `unstable_settings` gives each tab its own first screen (keyed by group name,
 * without the parentheses), which is also what sits under a listing opened
 * from a link: Back from /jobs/<slug> lands on the board, and from
 * /companies/<slug> on the directory. tests/routing.test.tsx holds all of this
 * to account.
 */
export const unstable_settings = {
  home: { anchor: 'index' },
  jobs: { anchor: 'jobs/index' },
  companies: { anchor: 'companies/index' },
};

export default function TabStack() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { fontFamily: font.semibold, color: colors.foreground },
        headerLargeTitleStyle: { fontFamily: font.bold, color: colors.foreground },
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
