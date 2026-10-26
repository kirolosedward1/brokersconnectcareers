import { cleanNote, NOTE_MAX } from '@/lib/saved-note';
import { callAction } from '~/lib/api';
import { createLocalList } from '~/lib/local-list';

/**
 * A line a candidate keeps about a saved listing — "spoke to Mona, interview
 * Sunday", "asked for 12k" — for themselves only. Kept on the bookmark itself
 * (saved_jobs.note, migration 356) and written through the website's
 * setSavedJobNote, so the website's saved page shows the same note and a new
 * phone finds it. Shown under the saved card and on the listing while it is
 * saved (note-queries.ts reads and writes it there).
 *
 * Taking the bookmark off deletes the row and the note in it. The note is held
 * while the app runs, so Undo, or saving it again soon after, puts it back.
 *
 * Notes kept on the phone before this (bc.saved-notes.v1) are posted once by
 * moveToAccount, then the phone's copy is let go.
 */
export type JobNote = { id: string; text: string; updatedAt?: number };

export { cleanNote, NOTE_MAX };

/** Keeps the note on a saved listing, or — written empty — takes it away; the note as kept. */
export async function postNote(jobId: string, text: string): Promise<string | null> {
  const result = await callAction('setSavedJobNote', { jobId, note: cleanNote(text) });
  if (!result.ok) throw new Error(result.error);
  return result.data?.note ?? null;
}

/**
 * Notes taken off with their bookmark, by person and listing: what an Undo
 * puts back. Held while the app runs; a few at most.
 */
const takenWithBookmark = new Map<string, string>();
const TAKEN_KEPT = 10;
const takenKey = (owner: string, jobId: string) => `${owner}\n${jobId}`;

/** The bookmark is going: its note, if it had one, is held for an Undo. */
export function holdNote(owner: string, jobId: string, note: string | null): void {
  const key = takenKey(owner, jobId);
  takenWithBookmark.delete(key);
  if (!note) return;
  takenWithBookmark.set(key, note);
  // The oldest let go first: a Map keeps the order things were put in.
  while (takenWithBookmark.size > TAKEN_KEPT) takenWithBookmark.delete(takenWithBookmark.keys().next().value as string);
}

/** The bookmark is back: so is the note it took with it. The note put back, or null. */
export async function restoreNote(owner: string, jobId: string): Promise<string | null> {
  const key = takenKey(owner, jobId);
  const note = takenWithBookmark.get(key);
  takenWithBookmark.delete(key);
  if (!note) return null;
  try {
    return await postNote(jobId, note);
  } catch {
    return null;
  }
}

/** For tests: nothing held for an Undo. */
export function forgetTakenNotesForTests() {
  takenWithBookmark.clear();
}

/**
 * Where notes were kept before they moved to the account: on this phone, per
 * person. Read once, by moveToAccount (move.ts), which posts each to its
 * bookmark and empties the list; nothing writes to it any more.
 */
export const deviceNotes = createLocalList<JobNote>('bc.saved-notes.v1', {
  max: 200,
  idOf: (note) => note.id,
  valid: (item): item is JobNote => {
    const note = item as JobNote | null;
    return Boolean(note && typeof note.id === 'string' && typeof note.text === 'string' && note.text.trim().length > 0);
  },
});
