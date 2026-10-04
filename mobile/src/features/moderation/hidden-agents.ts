import { createHiddenStore } from './hidden-store';

/**
 * Consultants a company has hidden on this phone — the directory's own
 * "block": the App Store asks that a reader can stop seeing whoever they find
 * abusive, and in the directory that is a consultant's profile. Hidden here,
 * the consultant leaves the directory and the shortlist on this phone until
 * the reader takes them back from the profile, which says it is hidden.
 * Reporting the profile (reportTarget) is what reaches the team.
 *
 * Kept on the device, as hidden companies are: a list of profile ids.
 */
const agents = createHiddenStore('bc.hidden-agents.v1');

export const hideAgent = agents.hide;
export const unhideAgent = agents.unhide;

/** The hidden consultant profile ids, kept current wherever they change. */
export function useHiddenAgents(): ReadonlySet<string> {
  return agents.useHidden();
}

/** A list without the consultants hidden on this phone. */
export function withoutHiddenAgents<T extends { id: string }>(items: T[], ids: ReadonlySet<string>): T[] {
  return ids.size ? items.filter((item) => !ids.has(item.id)) : items;
}
