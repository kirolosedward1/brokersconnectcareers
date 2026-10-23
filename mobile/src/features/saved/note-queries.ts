import { useMutation } from '@tanstack/react-query';
import { cleanNote, postNote, type JobNote } from './notes';
import { useEditSavedMark, useSavedMark } from './queries';

/** This candidate's note on a listing, while it is saved — as the website shows it too. */
export function useJobNote(jobId: string): JobNote | null {
  const note = useSavedMark(jobId)?.note;
  return note ? { id: jobId, text: note } : null;
}

/**
 * Keeps the note on a saved listing, or — written empty — takes it away:
 * shown at once, and put back as it was if the website says no (`onFailed`
 * then says so; it is called even once the sheet has closed).
 */
export function useKeepNote(onFailed: () => void) {
  const edit = useEditSavedMark();
  return useMutation({
    mutationFn: ({ jobId, text }: { jobId: string; text: string }) => postNote(jobId, text),
    onMutate: ({ jobId, text }) => edit(jobId, { note: cleanNote(text) || null }),
    onError: (_error, _input, restore) => {
      restore?.();
      onFailed();
    },
  });
}
