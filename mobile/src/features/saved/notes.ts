import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { cleanNote, NOTE_MAX } from '@/lib/saved-note';
import { callAction } from '~/lib/api';
import { createLocalList } from '~/lib/local-list';
import { supabase } from '~/lib/supabase';
import { useCandidateId } from './candidate';

/**
 * A line a candidate keeps about a saved listing — "spoke to Mona, interview
 * Sunday", "asked for 12k" — for themselves only. It lives with the bookmark
 * (saved_jobs.note, migration 353): written through the website's own action
 * (setSavedJobNote), read under row-level security, and shown under the
 * saved card and on the listing while it is saved — on the website's saved
 * page too, which is where it was missing while the phone kept it alone.
 *
 * Shown at once and put back if the server says no, as every other change
 * here is. Taking the bookmark off takes the note with it on the server; the
 * text is held in memory meanwhile so Undo brings it back (takeNoteWithBookmark).
 *
 * Notes kept on the phone before this (bc.saved-notes.v1) are carried to the
 * server the first time the saved list is read (carryDeviceNotes), then the
 * phone's copy is let go.
 */
export { cleanNote, NOTE_MAX };

export type JobNote = { id: string; text: string };

/** Each saved listing's note, by listing id — only those with one. */
export type Notes = Record<string, string>;

export const notesKey = (candidateId: string | null) => ['saved', 'notes', candidateId] as const;

/** This person's notes, read with the bookmarks and kept current wherever one changes. */
export function useJobNotes(): Notes {
  const candidateId = useCandidateId();
  const { data } = useQuery({
    queryKey: notesKey(candidateId),
    enabled: Boolean(candidateId),
    staleTime: 60_000,
    queryFn: async (): Promise<Notes> => {
      const { data: rows, error } = await supabase
        .from('saved_jobs')
        .select('job_id,note')
        .eq('candidate_id', candidateId as string)
        .not('note', 'is', null);
      if (error) throw error;
      return Object.fromEntries((rows ?? []).map((row) => [row.job_id as string, row.note as string]));
    },
  });
  return data ?? {};
}

/** This person's note on a listing, kept current wherever it changes. */
export function useJobNote(jobId: string): JobNote | null {
  const text = useJobNotes()[jobId];
  return text ? { id: jobId, text } : null;
}

function setNote(queryClient: QueryClient, candidateId: string | null, jobId: string, text: string | null) {
  queryClient.setQueryData<Notes>(notesKey(candidateId), (notes = {}) => {
    const next = { ...notes };
    if (text) next[jobId] = text;
    else delete next[jobId];
    return next;
  });
}

/** The notes the saved list came with (useSavedJobs reads them beside the bookmarks). */
export function rememberNotes(queryClient: QueryClient, candidateId: string | null, rows: { job_id: string; note: string | null }[]) {
  queryClient.setQueryData<Notes>(
    notesKey(candidateId),
    Object.fromEntries(rows.filter((row) => row.note).map((row) => [row.job_id, row.note as string])),
  );
}

/**
 * Keeping and deleting a note: the website's action, shown at once. `keep`
 * with nothing left after trimming is `remove`. Whether the server took it.
 */
export function useNoteActions() {
  const queryClient = useQueryClient();
  const candidateId = useCandidateId();

  const mutation = useMutation({
    mutationFn: async ({ jobId, text }: { jobId: string; text: string | null }) => {
      const result = await callAction('setSavedJobNote', { jobId, note: text });
      if (!result.ok) throw new Error(result.error);
      return result.data?.note ?? null;
    },
    onMutate: async ({ jobId, text }) => {
      await queryClient.cancelQueries({ queryKey: notesKey(candidateId) });
      const before = queryClient.getQueryData<Notes>(notesKey(candidateId))?.[jobId] ?? null;
      setNote(queryClient, candidateId, jobId, text);
      return { before };
    },
    onError: (_error, { jobId }, context) => setNote(queryClient, candidateId, jobId, context?.before ?? null),
    // The server's own text (trimmed and cut the same way) is what stays.
    onSuccess: (note, { jobId }) => setNote(queryClient, candidateId, jobId, note),
  });

  const write = (jobId: string, text: string | null) => mutation.mutateAsync({ jobId, text }).then(() => true, () => false);
  return {
    keep: (jobId: string, text: string) => write(jobId, cleanNote(text) || null),
    remove: (jobId: string) => write(jobId, null),
  };
}

/** The note a bookmark took with it, for the few seconds Undo is offered. */
const takenWithBookmark = new Map<string, string>();
const TAKEN_KEPT = 20;

/** The bookmark is going: the server drops the note with it; the words are held for Undo. */
export function takeNoteWithBookmark(queryClient: QueryClient, candidateId: string, jobId: string) {
  const text = queryClient.getQueryData<Notes>(notesKey(candidateId))?.[jobId];
  setNote(queryClient, candidateId, jobId, null);
  if (!text) return;
  const key = `${candidateId}:${jobId}`;
  takenWithBookmark.delete(key);
  takenWithBookmark.set(key, text);
  while (takenWithBookmark.size > TAKEN_KEPT) takenWithBookmark.delete(takenWithBookmark.keys().next().value as string);
}

/** The bookmark is back (Undo, or saved again): so is the note it took, if one was held. */
export async function restoreNoteWithBookmark(queryClient: QueryClient, candidateId: string, jobId: string): Promise<void> {
  const key = `${candidateId}:${jobId}`;
  const text = takenWithBookmark.get(key);
  if (!text) return;
  takenWithBookmark.delete(key);
  setNote(queryClient, candidateId, jobId, text);
  const result = await callAction('setSavedJobNote', { jobId, note: text }).catch(() => null);
  if (!result?.ok) setNote(queryClient, candidateId, jobId, null);
}

/** For tests: nothing held for an Undo. */
export function forgetTakenNotesForTests() {
  takenWithBookmark.clear();
}

/**
 * The notes the app kept on the phone before they lived with the bookmark:
 * read once more to carry them over, never written again.
 */
export type DeviceNote = { id: string; text: string; updatedAt: number };
export const deviceNotes = createLocalList<DeviceNote>('bc.saved-notes.v1', {
  max: 200,
  idOf: (note) => note.id,
  valid: (item): item is DeviceNote => {
    const note = item as DeviceNote | null;
    return Boolean(note && typeof note.id === 'string' && typeof note.text === 'string' && note.text.trim().length > 0);
  },
});

const carried = new Set<string>();

/**
 * Carries this phone's notes to the server, once per launch: each one whose
 * listing is still saved and has no note there yet is posted; one whose
 * listing is no longer saved is let go. The phone's copy is cleared once
 * every note has been posted or let go — a post that got no answer leaves
 * it for the next launch.
 */
export async function carryDeviceNotes(
  queryClient: QueryClient,
  candidateId: string,
  savedIds: readonly string[],
  serverNotes: Notes,
): Promise<void> {
  if (carried.has(candidateId)) return;
  carried.add(candidateId);
  const kept = await deviceNotes.read(candidateId);
  if (!kept.length) return;
  let left = 0;
  for (const note of kept) {
    if (!savedIds.includes(note.id) || serverNotes[note.id]) continue;
    const text = cleanNote(note.text);
    if (!text) continue;
    const result = await callAction('setSavedJobNote', { jobId: note.id, note: text }).catch(() => null);
    if (result?.ok) setNote(queryClient, candidateId, note.id, result.data?.note ?? text);
    else if (result === null) left += 1;
  }
  if (left === 0) deviceNotes.clear(candidateId);
  else carried.delete(candidateId);
}

/** For tests: the carry-over may run again. */
export function forgetCarriedNotesForTests() {
  carried.clear();
}
