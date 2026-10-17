import { useEffect, useMemo, useRef } from 'react';
import { useMyApplications } from '~/features/applications/queries';
import { useListOwner } from '~/features/jobs/recent';
import { useHiddenJobs } from '~/features/moderation/hidden-jobs';
import { useSavedJobs } from './queries';
import { useReminderWords } from './reminder-words';
import { cancelReminder, isPending, jobReminders, reconcileReminders, restoreReminder } from './reminders';

/**
 * The reminders before a saved listing closes, kept in step with the saved
 * list wherever the reader is — not only on the Saved tab, which a reminder
 * set and forgotten may never see again: a listing closed early, given a new
 * closing date, or unsaved on the website has its reminder taken back or
 * moved at the next read of the list. While somebody holds a reminder still
 * to go off, the list is read at launch and as the app comes back to the
 * front (the query client's focus); the Saved tab's own reads count too.
 *
 * A listing applied to since has nothing left to remind of: "apply before it
 * closes" for an application already sent is gone with it. One set aside with
 * "Hide this listing" keeps no reminder either — its card, the way to take it
 * back, has gone from Saved — and has it back if the hiding is undone.
 *
 * Mounted once, beside the root stack (PushBridge).
 */
export function useRemindersFollowSaved() {
  const owner = useListOwner();
  const kept = jobReminders.useItems(owner);
  const holding = kept.some((reminder) => isPending(reminder));
  const jobs = useSavedJobs({ active: holding });
  const reminderWords = useReminderWords();
  const applications = useMyApplications();
  const applied = useMemo(() => new Set((applications.data ?? []).map((application) => application.job_id)), [applications.data]);

  const read = jobs.isSuccess ? jobs.dataUpdatedAt : 0;
  useEffect(() => {
    if (!read || !jobs.data) return;
    const all = jobs.data;
    // Applied to: as good as no longer saved, for a reminder to apply.
    void reconcileReminders(
      owner,
      all.filter((job) => !applied.has(job.id)),
      read,
      (id) => {
        const job = all.find((item) => item.id === id);
        return job ? reminderWords(job) : null;
      },
    );
    // Once per read of the list or of the applications; the words are the same catalogue's each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, read, applied]);

  // Hidden: its reminder held aside, for an Undo; shown again: put back.
  const hiddenJobs = useHiddenJobs();
  const before = useRef<{ owner: string; hidden: ReadonlySet<string> } | null>(null);
  const keptIds = kept.map((reminder) => reminder.id).join('\n');
  useEffect(() => {
    const was = before.current?.owner === owner ? before.current.hidden : new Set<string>();
    before.current = { owner, hidden: hiddenJobs };
    for (const id of keptIds.split('\n')) {
      if (id && hiddenJobs.has(id)) void cancelReminder(owner, id, { withBookmark: true });
    }
    for (const id of was) {
      if (!hiddenJobs.has(id)) void restoreReminder(owner, id);
    }
  }, [owner, hiddenJobs, keptIds]);
}
