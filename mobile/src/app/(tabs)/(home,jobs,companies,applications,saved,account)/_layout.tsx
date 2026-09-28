import { Stack } from 'expo-router';
import { useStackOptions } from '~/components/navigation/stack-options';

/**
 * One stack per tab, shared by all of them.
 *
 * A listing and a company page are reachable from every tab — the home feed,
 * the board, a company's own roles, an application, a bookmark — and so are
 * the bell's feed and the companies directory (a candidate has no Companies
 * tab), so their screens live here, in the group every tab expands from.
 * Pushing /jobs/<slug> from the home tab stays in the home tab, with Back to
 * the home screen, rather than jumping to the board.
 *
 * `unstable_settings` gives each tab its own first screen (keyed by group name,
 * without the parentheses), which is also what sits under a page opened from
 * a link: Back from /jobs/<slug> lands on the board, and from
 * /companies/<slug> on the directory. The Account tab's screens (the account,
 * deleting it) are its own, under (account). tests/routing.test.tsx holds all
 * of this to account.
 */
export const unstable_settings = {
  home: { anchor: 'index' },
  jobs: { anchor: 'jobs/index' },
  companies: { anchor: 'companies/index' },
  applications: { anchor: 'dashboard/applications/index' },
  saved: { anchor: 'dashboard/saved/index' },
  account: { anchor: 'account/index' },
};

export default function TabStack() {
  return <Stack screenOptions={useStackOptions()} />;
}
