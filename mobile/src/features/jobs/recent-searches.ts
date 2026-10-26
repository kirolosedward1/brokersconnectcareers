import { createLocalList } from '~/lib/local-list';

/** As many as the sheet offers. */
const KEPT = 6;

/**
 * The words this person searched the board for lately, newest first, on this
 * phone only: the filter sheet offers them again, a tap from searching once
 * more. One list per person (src/lib/local-list.ts), nothing sent anywhere.
 */
export const recentSearches = createLocalList<string>('bc.recent-searches.v1', {
  max: KEPT,
  // The same words in another case or spacing are the same search.
  idOf: (words) => words.trim().toLocaleLowerCase(),
  valid: (item): item is string => typeof item === 'string' && item.trim().length > 0,
});

/** Kept when the board is searched for words. */
export function rememberSearch(owner: string, words: string | null | undefined) {
  const kept = words?.trim();
  if (kept) recentSearches.add(owner, kept);
}
