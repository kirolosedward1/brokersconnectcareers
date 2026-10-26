import * as Notifications from 'expo-notifications';
import { readDate } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import type { JobStatus } from '@/lib/supabase/database.types';
import { useListOwner } from '~/features/jobs/recent';
import { askPermission, readPermission } from '~/features/push/device';
import { callAction } from '~/lib/api';
import { createLocalList } from '~/lib/local-list';

/**
 * "Remind me before it closes": a notification of the app's own, the day
 * before a saved listing stops taking applications, at ten in the morning in
 * Cairo — early enough in the day to apply, late enough not to wake anybody.
 *
 * When it goes off is kept on the bookmark (saved_jobs.remind_at, migration
 * 365), written through the website's setSavedJobReminder: the website's saved
 * page says it and can take it back, a new phone finds it, and a bookmark
 * taken off anywhere takes it with it. The notification scheduled on this
 * phone is a copy of that, made to match each time the saved list is read
 * (reconcileReminders, from reminders-follow.ts).
 *
 * The copy is kept per person (src/lib/local-list.ts) with the system's id for
 * it, so it can be taken back: from the card, by taking the bookmark off, or
 * when the listing closes early. A person's reminders are theirs: when they sign out
 * the phone stops holding them, so a lock screen never tells the next person
 * what they were applying for, and they are put back when the person returns
 * (syncReminders, from the push bridge).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The hour, on Cairo's clock, the day before a listing closes. */
export const REMINDER_HOUR = 10;
/** A closing this many days away, or fewer, is said on the saved card. */
export const CLOSING_SOON_DAYS = 3;

export type JobReminder = {
  /** The listing's id. */
  id: string;
  slug: string;
  /** What the notification says, in the language it was set in. */
  title: string;
  body: string;
  /** When it goes off, and the closing it was worked out from. */
  fireAt: number;
  expiresAt: string;
  /** The system's name for the scheduled notification, to take it back by. */
  notificationId: string;
  setAt: number;
};

/** iOS holds 64 scheduled notifications for an app; a person keeps far fewer reminders than that. */
const KEPT = 50;

function isReminder(item: unknown): item is JobReminder {
  const reminder = item as JobReminder | null;
  return Boolean(
    reminder &&
      typeof reminder.id === 'string' &&
      typeof reminder.slug === 'string' &&
      typeof reminder.title === 'string' &&
      typeof reminder.body === 'string' &&
      typeof reminder.fireAt === 'number' &&
      typeof reminder.expiresAt === 'string' &&
      typeof reminder.notificationId === 'string',
  );
}

export const jobReminders = createLocalList<JobReminder>('bc.saved-reminders.v1', { max: KEPT, idOf: (reminder) => reminder.id, valid: isReminder });

/* ---------------------------------------------------------------------------
   Cairo's clock. Egypt keeps summer time again (UTC+3 from the last Friday of
   April to the last Thursday of October, UTC+2 otherwise), so the offset is
   read from the calendar for each moment rather than assumed. The same zone
   data the shared formatters use (src/lib/intl-polyfills.ts).
--------------------------------------------------------------------------- */

let cairoClock: Intl.DateTimeFormat | null = null;

type Wall = { year: number; month: number; day: number; hour: number; minute: number };

/** The date and time on a Cairo wall clock at a moment. */
function cairoWall(date: Date): Wall {
  cairoClock ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const parts = cairoClock.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  // Some engines write midnight as 24 under h23's neighbour h24; it is the same instant.
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour') % 24, minute: part('minute') };
}

/** How far Cairo's clock is ahead of UTC at a moment, in milliseconds. */
function cairoOffset(date: Date): number {
  const wall = cairoWall(date);
  const minute = Math.floor(date.getTime() / 60_000) * 60_000;
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - minute;
}

/**
 * The moment a Cairo wall clock shows the given date and time. The offset is
 * guessed at the wall time read as UTC, then read again at the moment that
 * guess gives: right on either side of a change of clocks, which Egypt makes
 * at midnight, never at ten in the morning.
 */
function cairoMoment(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wall - cairoOffset(new Date(wall));
  return new Date(wall - cairoOffset(new Date(guess)));
}

/** A moment's day on Cairo's calendar, as a count of days: two of them subtract to the days between. */
function cairoDayNumber(date: Date): number {
  const wall = cairoWall(date);
  return Date.UTC(wall.year, wall.month - 1, wall.day) / DAY_MS;
}


/**
 * When to remind somebody of a listing closing at `expiresAt`: ten in the
 * morning in Cairo, the day before the day it closes on Cairo's calendar. If
 * that has passed and the listing is still open, an hour from now, so long as
 * that is still before it closes. Null when there is no reminding left to do:
 * no closing date, closed already, or closing within the hour.
 */
export function reminderAt(expiresAt: string | Date | null | undefined, now: Date = new Date()): Date | null {
  const closes = readDate(expiresAt);
  if (!closes || closes.getTime() <= now.getTime()) return null;
  const closing = cairoWall(closes);
  // The day before, as a calendar date (Date.UTC carries a day 0 back into the month before).
  const before = new Date(Date.UTC(closing.year, closing.month - 1, closing.day - 1));
  const at = cairoMoment(before.getUTCFullYear(), before.getUTCMonth() + 1, before.getUTCDate(), REMINDER_HOUR);
  if (at.getTime() > now.getTime()) return at;
  const soon = new Date(now.getTime() + HOUR_MS);
  return soon.getTime() < closes.getTime() ? soon : null;
}

/**
 * How many days on Cairo's calendar until a listing closes — 0 on the day
 * itself — or null when it has no closing date or has closed.
 */
export function closingInDays(expiresAt: string | Date | null | undefined, now: Date = new Date()): number | null {
  const closes = readDate(expiresAt);
  if (!closes || closes.getTime() <= now.getTime()) return null;
  return cairoDayNumber(closes) - cairoDayNumber(now);
}

/** Whether a reminder going off at `at` is on the day the listing closes, or the day before. */
export function reminderDay(at: Date, expiresAt: string | Date): 'today' | 'tomorrow' {
  const closes = readDate(expiresAt);
  return closes && cairoDayNumber(closes) === cairoDayNumber(at) ? 'today' : 'tomorrow';
}

/** Whether a bookmark's remind_at is still to come. */
export function remindAtPending(remindAt: string | null, now: number = Date.now()): boolean {
  return remindAt !== null && new Date(remindAt).getTime() > now;
}

/** Whether a reminder is still to go off: one that has gone off is done with, wherever it is still listed. */
export function isPending(reminder: JobReminder, now: number = Date.now()): boolean {
  return reminder.fireAt > now;
}

/* ---------------------------------------------------------------------------
   The system's side. Every change goes through one queue: a check of what is
   scheduled must never see a reminder half set (scheduled, not yet listed)
   and take it for somebody else's.
--------------------------------------------------------------------------- */

let queue: Promise<unknown> = Promise.resolve();

function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/** The listing a scheduled notification reminds of, when it is one of these. */
function reminderFor(data: unknown): string | null {
  const id = (data as { reminderFor?: unknown } | null | undefined)?.reminderFor;
  return typeof id === 'string' ? id : null;
}

async function cancelScheduled(notificationId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Gone off already, or never there: nothing left to take back.
  }
}

/** Schedules what a reminder says, at its time; a tap opens the listing (PushBridge, localHrefOf). */
function schedule(reminder: Pick<JobReminder, 'id' | 'slug' | 'title' | 'body' | 'fireAt'>): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: reminder.title,
      body: reminder.body,
      sound: 'default',
      data: { localHref: `/jobs/${reminder.slug}`, reminderFor: reminder.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.fireAt },
  });
}

/** What the notification says, given whether it goes off on the closing day or the day before. */
export type ReminderWords = (day: 'today' | 'tomorrow') => { title: string; body: string };

export type ReminderResult =
  | { status: 'set'; at: Date }
  /** The phone does not let the app notify. */
  | { status: 'denied' }
  /** Closing within the hour, or closed: nothing to remind of. */
  | { status: 'closing' }
  | { status: 'failed' };

/** Tells the account when to remind, or (null) that there is no reminder; whether it took it. */
async function keepOnAccount(jobId: string, at: Date | null): Promise<'kept' | 'closing' | 'not_saved' | 'failed'> {
  try {
    const result = await callAction('setSavedJobReminder', { jobId, remindAt: at ? at.toISOString() : null });
    if (result.ok) return 'kept';
    return result.error === 'closing' || result.error === 'not_saved' ? result.error : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Sets the reminder for a saved listing, replacing one already set: on the
 * account first, then on the phone. Asks the phone first when it has never
 * been asked: the reader has just said what they want to hear about, the
 * reason the app waits for (features/push).
 */
export function setReminder(
  owner: string,
  job: { id: string; slug: string; expires_at: string | null },
  words: ReminderWords,
  now: Date = new Date(),
): Promise<ReminderResult> {
  return serially(async (): Promise<ReminderResult> => {
    const at = reminderAt(job.expires_at, now);
    if (!at || !job.expires_at) return { status: 'closing' };
    let permission = await readPermission().catch(() => 'undetermined' as const);
    if (permission === 'undetermined') permission = await askPermission().catch(() => 'denied' as const);
    if (permission !== 'granted') return { status: 'denied' };
    const kept = await keepOnAccount(job.id, at);
    if (kept === 'closing') return { status: 'closing' };
    if (kept !== 'kept') return { status: 'failed' };
    try {
      const before = (await jobReminders.read(owner)).find((reminder) => reminder.id === job.id);
      if (before) await cancelScheduled(before.notificationId);
      const { title, body } = words(reminderDay(at, job.expires_at));
      const fields = { id: job.id, slug: job.slug, title, body, fireAt: at.getTime() };
      const notificationId = await schedule(fields);
      jobReminders.add(owner, { ...fields, expiresAt: job.expires_at, notificationId, setAt: now.getTime() });
      return { status: 'set', at };
    } catch {
      return { status: 'failed' };
    }
  });
}

/**
 * Reminders taken back with their bookmark, by person and listing, so an Undo
 * that puts the bookmark back puts the reminder back too (restoreReminder) —
 * as it does the note. Held while the app runs; a few at most.
 */
const takenWithBookmark = new Map<string, JobReminder>();
const TAKEN_KEPT = 10;
const takenKey = (owner: string, jobId: string) => `${owner}\n${jobId}`;

/**
 * When each reminder was last taken back here, by person and listing: a read
 * of the saved list from before then still says it is set, and must not put
 * it back (reconcileReminders).
 */
const takenBackAt = new Map<string, number>();

/**
 * Takes a listing's reminder back, from the account and the phone; whether it
 * is gone (false when the website could not be told, and nothing changed).
 * `withBookmark`: it goes because the bookmark did — the row and its reminder
 * are gone already, or (a listing hidden) stay on the account — so only the
 * phone's copy goes, and comes back if the bookmark does.
 */
export function cancelReminder(owner: string, jobId: string, { withBookmark = false }: { withBookmark?: boolean } = {}): Promise<boolean> {
  return serially(async () => {
    if (!withBookmark) {
      if ((await keepOnAccount(jobId, null)) === 'failed') return false;
      takenBackAt.set(takenKey(owner, jobId), Date.now());
    }
    const reminder = (await jobReminders.read(owner)).find((item) => item.id === jobId);
    if (!reminder) return !withBookmark;
    jobReminders.remove(owner, jobId);
    await cancelScheduled(reminder.notificationId);
    if (withBookmark) {
      takenWithBookmark.delete(takenKey(owner, jobId));
      takenWithBookmark.set(takenKey(owner, jobId), reminder);
      // The oldest let go first: a Map keeps the order things were put in.
      while (takenWithBookmark.size > TAKEN_KEPT) takenWithBookmark.delete(takenWithBookmark.keys().next().value as string);
    }
    return true;
  });
}

/**
 * The bookmark is back (Undo, saved again, or the listing shown again): so is
 * the reminder it took with it — on the account and the phone — if it is
 * still to go off, none has been set since, and the phone still lets the app
 * notify. Never asks the phone anything; whether it was put back.
 */
export function restoreReminder(owner: string, jobId: string, now: Date = new Date()): Promise<boolean> {
  return serially(async () => {
    const key = takenKey(owner, jobId);
    const reminder = takenWithBookmark.get(key);
    takenWithBookmark.delete(key);
    if (!reminder || !isPending(reminder, now.getTime())) return false;
    if ((await jobReminders.read(owner)).some((item) => item.id === jobId)) return false;
    if ((await readPermission().catch(() => 'denied')) !== 'granted') return false;
    if ((await keepOnAccount(jobId, new Date(reminder.fireAt))) !== 'kept') return false;
    try {
      // Set again now: a read of the list from before the bookmark came back does not take it for unsaved.
      jobReminders.add(owner, { ...reminder, notificationId: await schedule(reminder), setAt: now.getTime() });
      return true;
    } catch {
      return false;
    }
  }).catch(() => false);
}

/** For tests: nothing held for an Undo. */
export function forgetTakenRemindersForTests() {
  takenWithBookmark.clear();
  takenBackAt.clear();
}

/**
 * The phone's reminders made to match the person using the app (`owner`;
 * 'anon' signed out, who keeps none): anybody else's are taken off the phone —
 * still listed under their name, to be put back when they return — and this
 * person's are put back where the phone no longer holds them, if it still
 * lets the app notify. Those that have gone off are let go. Never asks the
 * phone anything; a failure leaves things as they were.
 */
export function syncReminders(owner: string, now: Date = new Date()): Promise<void> {
  return serially(async () => {
    const kept = await jobReminders.read(owner);
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter((request) => reminderFor(request.content.data) !== null);
    const keptIds = new Set(kept.map((reminder) => reminder.notificationId));
    for (const request of ours) {
      if (!keptIds.has(request.identifier)) await cancelScheduled(request.identifier);
    }
    const live = new Set(ours.map((request) => request.identifier));
    let allowed: boolean | null = null;
    for (const reminder of kept) {
      if (!isPending(reminder, now.getTime())) {
        jobReminders.remove(owner, reminder.id);
        continue;
      }
      if (live.has(reminder.notificationId)) continue;
      allowed ??= (await readPermission().catch(() => 'denied')) === 'granted';
      if (!allowed) {
        jobReminders.remove(owner, reminder.id);
        continue;
      }
      jobReminders.add(owner, { ...reminder, notificationId: await schedule(reminder) });
    }
  }).catch(() => {});
}

/**
 * The phone's reminders made to match the saved list as just read (`readAt`),
 * with each bookmark's `remind_at` — the account's word on when to remind:
 *
 * - one the account no longer holds — taken back on the website, the bookmark
 *   taken off anywhere — goes from the phone;
 * - one the account holds and the phone does not — set on another phone, or
 *   before this one was signed in — is scheduled here, if the phone lets the
 *   app notify (it is never asked here);
 * - one whose listing has closed, early or for good, goes from both;
 * - one whose closing date moved is worked out again for the new date, and the
 *   account told.
 *
 * Only reminders set here before the read are judged by it, so one set a
 * moment ago is not taken for unsaved.
 */
export function reconcileReminders(
  owner: string,
  jobs: readonly { id: string; slug: string; status: JobStatus; expires_at: string | null; remind_at: string | null }[],
  readAt: number,
  wordsFor: (jobId: string) => ReminderWords | null,
  now: Date = new Date(),
): Promise<void> {
  return serially(async () => {
    const kept = await jobReminders.read(owner);
    const held = new Map(kept.map((reminder) => [reminder.id, reminder]));
    const drop = async (reminder: JobReminder | undefined) => {
      if (!reminder) return;
      jobReminders.remove(owner, reminder.id);
      await cancelScheduled(reminder.notificationId);
    };

    for (const reminder of kept) {
      const job = jobs.find((item) => item.id === reminder.id);
      if ((!job || !job.remind_at) && reminder.setAt < readAt) await drop(reminder);
    }

    let allowed: boolean | null = null;
    for (const job of jobs) {
      if (!job.remind_at) continue;
      const local = held.get(job.id);
      const at = jobIsLive(job) ? reminderAt(job.expires_at, now) : null;
      if (!at || !job.expires_at) {
        // Nothing left to remind of, here or anywhere.
        await drop(local);
        await keepOnAccount(job.id, null);
        continue;
      }
      let fireAt = new Date(job.remind_at).getTime();
      if (Number.isNaN(fireAt) || fireAt <= now.getTime()) {
        // Gone off already: done with.
        await drop(local);
        continue;
      }
      // The closing date moved since it was set (or the reminder now falls after it).
      const moved = (local && local.expiresAt !== job.expires_at) || fireAt >= new Date(job.expires_at).getTime();
      if (moved && at.getTime() !== fireAt && (await keepOnAccount(job.id, at)) === 'kept') fireAt = at.getTime();
      if (local && local.fireAt === fireAt && local.expiresAt === job.expires_at) continue;
      const words = wordsFor(job.id);
      if (!words) continue;
      // Taken back here since the read: it is not set, whatever the read says.
      if (!local && (takenBackAt.get(takenKey(owner, job.id)) ?? 0) >= readAt) continue;
      if (!local) {
        allowed ??= (await readPermission().catch(() => 'denied')) === 'granted';
        if (!allowed) continue;
      }
      if (local) await cancelScheduled(local.notificationId);
      const { title, body } = words(reminderDay(new Date(fireAt), job.expires_at));
      const fields = { id: job.id, slug: job.slug, title, body, fireAt };
      jobReminders.add(owner, { ...fields, expiresAt: job.expires_at, notificationId: await schedule(fields), setAt: now.getTime() });
    }
  }).catch(() => {});
}

/** This person's reminder for a listing, while it is still to go off. */
export function useJobReminder(jobId: string): JobReminder | null {
  const reminder = jobReminders.useItems(useListOwner()).find((item) => item.id === jobId);
  return reminder && isPending(reminder) ? reminder : null;
}
