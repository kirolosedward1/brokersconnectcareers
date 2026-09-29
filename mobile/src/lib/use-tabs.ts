import { useSession } from './session';
import { tabsFor } from './tabs';

/**
 * Whether this person has the board — the Jobs tab. An employer does not
 * (their bar is their console), and a screen that exists in no tab of theirs
 * cannot be opened, so a "browse the jobs" button is not offered to them.
 */
export function useHasBoard(): boolean {
  return tabsFor(useSession().actor).includes('jobs');
}
