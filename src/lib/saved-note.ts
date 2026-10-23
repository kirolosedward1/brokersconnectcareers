/**
 * The candidate's own line about a saved listing (saved_jobs.note, migration
 * 353), as both sides keep it: trimmed, at most NOTE_MAX characters, and no
 * note at all when nothing is left. The action applies this before writing;
 * the website's editor and the app's sheet apply it to know whether anything
 * changed. No imports, so the app may bundle it.
 */
export const NOTE_MAX = 300;

/** A note as it is kept: trimmed, cut at the limit, trimmed again; '' for none. */
export function cleanNote(text: string): string {
  return text.trim().slice(0, NOTE_MAX).trim();
}
