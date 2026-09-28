import { Stack } from 'expo-router';
import { useStackOptions } from '~/components/navigation/stack-options';

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
  return <Stack screenOptions={useStackOptions()} />;
}
