import { useListOwner } from '~/features/jobs/recent';
import { createLocalList } from '~/lib/local-list';

/**
 * A line a candidate keeps about a saved listing — "spoke to Mona, interview
 * Sunday", "asked for 12k" — for themselves only: on this phone, per person
 * (src/lib/local-list.ts), never sent anywhere. Shown under the saved card and
 * on the listing while it is saved.
 *
 * Kept when the bookmark is taken off, so Undo, or saving it again later,
 * brings the note back with it; the oldest go first past the limit.
 */
export type JobNote = { id: string; text: string; updatedAt: number };

/** What fits in a glance under a card. */
export const NOTE_MAX = 300;
/** Far more than anybody keeps saved at once. */
const KEPT = 200;

export const jobNotes = createLocalList<JobNote>('bc.saved-notes.v1', {
  max: KEPT,
  idOf: (note) => note.id,
  valid: (item): item is JobNote => {
    const note = item as JobNote | null;
    return Boolean(note && typeof note.id === 'string' && typeof note.text === 'string' && note.text.trim().length > 0);
  },
});

/** A note as it is kept: trimmed, and no longer than the limit. */
export function cleanNote(text: string): string {
  return text.trim().slice(0, NOTE_MAX).trim();
}

/** Keeps the note for a listing, or — written empty — takes it away. */
export function keepNote(owner: string, jobId: string, text: string, now: number = Date.now()): void {
  const clean = cleanNote(text);
  if (clean) jobNotes.add(owner, { id: jobId, text: clean, updatedAt: now });
  else jobNotes.remove(owner, jobId);
}

export function deleteNote(owner: string, jobId: string): void {
  jobNotes.remove(owner, jobId);
}

/** This person's note on a listing, kept current wherever it changes. */
export function useJobNote(jobId: string): JobNote | null {
  return jobNotes.useItems(useListOwner()).find((note) => note.id === jobId) ?? null;
}
