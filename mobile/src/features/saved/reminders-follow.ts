import { useEffect, useMemo, useRef, useState } from 'react';
import { useMyApplications } from '~/features/applications/queries';
import { useListOwner } from '~/features/jobs/recent';
import { useHiddenJobs } from '~/features/moderation/hidden-jobs';
import { moveToAccount } from './move';
import { useRefreshSavedMarks, useSavedJobs, useSavedMarks } from './queries';
import { useReminderWords } from './reminder-words';
import { cancelReminder, isPending, jobReminders, reconcileReminders, remindAtPending, restoreReminder } from './reminders';

/**
 * The reminders before a saved listing closes, kept in step with the saved
 * list wherever the reader is — not only on the Saved tab, which a reminder
 * set and forgotten may never see again. The bookmarks say when to remind
 * (saved_jobs.remind_at); the phone's scheduled notifications are made to
 * match at each read of the list (reconcileReminders): one taken back or
 * unsaved on the website goes, one set on another phone is scheduled here, a
 * listing closed early or given a new closing date has its reminder taken
 * back or moved. While the account or the phone holds a reminder still to go
 * off, the list is read at launch and as the app comes back to the front (the
 * query client's focus); the Saved tab's own reads count too.
 *
 * Before the first of those, what this phone kept on its own before notes
 * and reminders moved to the account is posted there, once (move.ts).
 *
 * A listing applied to since has nothing left to remind of: "apply before it
 * closes" for an application already sent is gone with it. A withdrawn
 * application is not that — they can apply again, so the reminder stands.
 * One set aside with "Hide this listing" keeps no reminder either — its card,
 * the way to take it back, has gone from Saved — and has it back if the
 * hiding is undone.
 *
 * Mounted once, beside the root stack (PushBridge).
 */
export function useRemindersFollowSaved() {
  const owner = useListOwner();
  const kept = jobReminders.useItems(owner);
  const { marks, readAt: marksRead } = useSavedMarks();
  const refreshMarks = useRefreshSavedMarks();
  const holding =
    kept.some((reminder) => isPending(reminder)) || marks.some((mark) => remindAtPending(mark.remind_at));
  const jobs = useSavedJobs({ active: holding });

  // Once the bookmarks have been read for this person: the phone's own notes
  // and reminders moved to them, after which the account's word is the whole of it.
  const [moved, setMoved] = useState<string | null>(null);
  const marksKnown = marksRead > 0;
  useEffect(() => {
    if (!marksKnown || owner === 'anon' || moved === owner) return;
    let current = true;
    void moveToAccount(owner, marks).then(({ done, posted }) => {
      if (!current) return;
      if (posted) void refreshMarks();
      // No answer: tried again at the next launch, and the phone's reminders left as they are till then.
      if (done) setMoved(owner);
    });
    return () => {
      current = false;
    };
    // Once per person, at the first read of their bookmarks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, marksKnown]);
  const reminderWords = useReminderWords();
  const applications = useMyApplications();
  const applied = useMemo(
    () => new Set((applications.data ?? []).filter((application) => application.status !== 'withdrawn').map((application) => application.job_id)),
    [applications.data],
  );

  const read = jobs.isSuccess ? jobs.dataUpdatedAt : 0;
  const hiddenJobs = useHiddenJobs();
  useEffect(() => {
    if (!read || !jobs.data || moved !== owner) return;
    const all = jobs.data;
    // The read of the list wrote the marks too; one taken since is not saved.
    const remindAt = new Map(marks.map((mark) => [mark.job_id, mark.remind_at]));
    // Applied to: as good as no longer saved, for a reminder to apply. Hidden:
    // its reminder held aside on the phone (below), left alone on the account.
    void reconcileReminders(
      owner,
      all
        .filter((job) => !applied.has(job.id) && !hiddenJobs.has(job.id) && remindAt.has(job.id))
        .map((job) => ({ ...job, remind_at: remindAt.get(job.id) ?? null })),
      // The older of the two reads: what it says was so at least then.
      Math.min(read, marksRead || read),
      (id) => {
        const job = all.find((item) => item.id === id);
        return job ? reminderWords(job) : null;
      },
    );
    // Once per read of the list or of the applications; the words are the same catalogue's each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, read, applied, moved, marksRead, hiddenJobs]);

  const keptIds = kept.map((reminder) => reminder.id).join('\n');
  // Held on the account, whether or not this phone has scheduled it.
  const remindedIds = marks
    .filter((mark) => mark.remind_at !== null)
    .map((mark) => mark.job_id)
    .join('\n');

  // Applied to, as the applications now read say: its reminder goes at once,
  // however lately it was set. Left to the saved list's next read, one set
  // from the Saved card a moment before applying — newer than that read —
  // still went off ("apply before it closes") an hour after the application.
  // No reminder is offered on a listing already applied to, so none is lost.
  useEffect(() => {
    for (const id of new Set([...keptIds.split('\n'), ...remindedIds.split('\n')])) {
      if (!id || !applied.has(id)) continue;
      void cancelReminder(owner, id).then((gone) => {
        if (gone && remindedIds.split('\n').includes(id)) void refreshMarks();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, applied, keptIds, remindedIds]);

  // Hidden: its reminder held aside, for an Undo; shown again: put back.
  const before = useRef<{ owner: string; hidden: ReadonlySet<string> } | null>(null);
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
