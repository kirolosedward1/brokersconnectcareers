import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanNote } from '@/lib/saved-note';
import { callAction } from '~/lib/api';
import { deviceNotes } from './notes';
import type { SavedMark } from './queries';
import { isPending, jobReminders } from './reminders';

/**
 * Notes and reminders were the phone's alone until they moved to the bookmark
 * (the note in migration 356, the reminder in migration 365). The first time a person's saved list is read after that,
 * what this phone kept for them is posted once: each note to a bookmark that
 * has none, each reminder still to go off to a bookmark that has none. One the
 * account already holds wins — it was written since, on the website or
 * another phone — and one on a listing no longer saved has nowhere to go.
 *
 * Done once per person, and only when every post was answered: no answer (the
 * phone offline, the website down) leaves it for the next launch rather than
 * losing the note. Then the phone's notes are emptied; the reminders stay, as
 * the copy of the account's they now are (reminders.ts).
 */

const MOVED = 'bc.saved-moved.v1';

/** Whether the website answered, yes or no; a refusal is final, no answer is not. */
async function post(write: () => Promise<{ ok: boolean }>): Promise<'answered' | 'unanswered'> {
  try {
    await write();
    return 'answered';
  } catch {
    return 'unanswered';
  }
}

/**
 * Moves what this phone kept for `owner` to their bookmarks, once. `done`:
 * moved (now or before), so the account's word is the whole of it; `posted`:
 * something was sent, so the bookmarks are worth reading again.
 */
export async function moveToAccount(
  owner: string,
  marks: readonly SavedMark[],
  now: number = Date.now(),
): Promise<{ done: boolean; posted: boolean }> {
  const key = `${MOVED}:${owner}`;
  if ((await AsyncStorage.getItem(key).catch(() => '1')) !== null) return { done: true, posted: false };

  let answered = true;
  let posted = false;
  for (const note of await deviceNotes.read(owner)) {
    const mark = marks.find((item) => item.job_id === note.id);
    if (!mark || mark.note) continue;
    const text = cleanNote(note.text);
    if (!text) continue;
    posted = true;
    if ((await post(() => callAction('setSavedJobNote', { jobId: note.id, note: text }))) === 'unanswered') answered = false;
  }
  for (const reminder of await jobReminders.read(owner)) {
    const mark = marks.find((item) => item.job_id === reminder.id);
    if (!mark || mark.remind_at || !isPending(reminder, now)) continue;
    posted = true;
    const remindAt = new Date(reminder.fireAt).toISOString();
    if ((await post(() => callAction('setSavedJobReminder', { jobId: reminder.id, remindAt }))) === 'unanswered') answered = false;
  }

  if (answered) {
    deviceNotes.clear(owner);
    await AsyncStorage.setItem(key, '1').catch(() => {});
  }
  return { done: answered, posted };
}
