import { useEffect } from 'react';
import { useListOwner } from '~/features/jobs/recent';
import { useSavedJobs } from './queries';
import { useReminderWords } from './reminder-words';
import { isPending, jobReminders, reconcileReminders } from './reminders';

/**
 * The reminders before a saved listing closes, kept in step with the saved
 * list wherever the reader is — not only on the Saved tab, which a reminder
 * set and forgotten may never see again: a listing closed early, given a new
 * closing date, or unsaved on the website has its reminder taken back or
 * moved at the next read of the list. While somebody holds a reminder still
 * to go off, the list is read at launch and as the app comes back to the
 * front (the query client's focus); the Saved tab's own reads count too.
 * Mounted once, beside the root stack (PushBridge).
 */
export function useRemindersFollowSaved() {
  const owner = useListOwner();
  const holding = jobReminders.useItems(owner).some((reminder) => isPending(reminder));
  const jobs = useSavedJobs({ active: holding });
  const reminderWords = useReminderWords();

  const read = jobs.isSuccess ? jobs.dataUpdatedAt : 0;
  useEffect(() => {
    if (!read || !jobs.data) return;
    const all = jobs.data;
    void reconcileReminders(owner, all, read, (id) => {
      const job = all.find((item) => item.id === id);
      return job ? reminderWords(job) : null;
    });
    // Once per read of the list; the words are the same catalogue's each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, read]);
}
