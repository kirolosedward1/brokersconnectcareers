import { createHiddenStore, type HiddenEntry } from './hidden-store';

/**
 * Single listings the reader set aside on this phone — swiped away on the
 * board, or "Hide this listing" from a card's menu — because that one is not
 * for them, without hiding everything its company posts (hidden-companies.ts).
 * They leave the board, Home and "roles like this" until taken back from
 * Account → "Hidden on this phone", or with Undo as they go.
 *
 * Kept on the device: a list of listing ids, with the title each had.
 */
const jobs = createHiddenStore('bc.hidden-jobs.v1');

export const hideJob = jobs.hide;
export const unhideJob = jobs.unhide;

/** The hidden listing ids, kept current wherever they change. */
export function useHiddenJobs(): ReadonlySet<string> {
  return jobs.useHidden();
}

/** The hidden listings with the titles they had, for Account → "Hidden on this phone". */
export function useHiddenJobEntries(): readonly HiddenEntry[] {
  return jobs.useEntries();
}

/** Whether the phone has said which listings are hidden (the root layout waits for it). */
export function useHiddenJobsLoaded(): boolean {
  return jobs.useLoaded();
}

/** A list without the listings hidden one by one. */
export function withoutHiddenJobs<T extends { id: string }>(items: T[], ids: ReadonlySet<string>): T[] {
  return ids.size ? items.filter((item) => !ids.has(item.id)) : items;
}
