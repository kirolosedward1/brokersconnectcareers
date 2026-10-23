/**
 * A candidate's note on a saved listing — "spoke to Mona, interview Sunday",
 * "asked for 12k" — kept on the bookmark itself (saved_jobs.note, migration
 * 356), so the website and the app show the same one. Shared by the website's
 * action and form and by the app, which imports it as `@/lib/saved-note`.
 */

/** What fits in a glance under a card; saved_jobs_note_shape holds the database to it. */
export const SAVED_NOTE_MAX = 300;

/** A note as it is kept: trimmed, and no longer than the limit. Empty means none. */
export function cleanSavedNote(text: string): string {
  return text.trim().slice(0, SAVED_NOTE_MAX).trim();
}
