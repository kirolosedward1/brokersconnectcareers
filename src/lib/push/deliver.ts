import 'server-only';
import { createTranslator } from 'next-intl';
import { createAdminClient } from '@/lib/supabase/admin';
import { configuredValue } from '@/lib/env';
import { intlFormats } from '@/lib/format';
import { retryDb } from '@/lib/jobs/db';
import { createDeadline, type Deadline } from '@/lib/jobs/policy';
import { logFailure } from '@/lib/observe';
import type { Translate } from '@/lib/notifications/title';
import type { LeasedPushRow } from '@/lib/supabase/database.types';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { receiptsFromExpo, sendToExpo } from './expo';
import { checkReceipts, sweepPushes, type PushLoad, type PushSweepDeps, type ReceiptDeps } from './sweep';

/**
 * The push sender, wired to the database (service role) and to Expo.
 *
 * Two callers. The cron route (/api/cron/push) sweeps every minute, reads
 * receipts and prunes — scheduled by pg_cron inside the database (migration
 * 329) and by Vercel Cron. And flushPushes(), which publish() runs right after
 * an action, so a push leaves within seconds of what caused it rather than at
 * the next minute. Both lease through the same function, so they never send
 * the same row twice.
 */

type Admin = ReturnType<typeof createAdminClient>;

const accessToken = () => configuredValue(process.env.EXPO_ACCESS_TOKEN) ?? null;

/** Seconds a leased row is ours: longer than one batch takes, well short of a minute. */
const LEASE_SECONDS = 45;

const translators: Partial<Record<'ar' | 'en', Translate>> = {};

/** A translator over the whole catalogue, outside any request — the bell's words, in the phone's language. */
function translator(locale: 'ar' | 'en'): Translate {
  translators[locale] ??= (() => {
    const t = createTranslator({
      locale,
      messages: locale === 'en' ? en : ar,
      formats: intlFormats,
      timeZone: 'Africa/Cairo',
      onError: () => {},
      getMessageFallback: () => '',
    });
    return (key, values) => t(key as never, values as never);
  })();
  return translators[locale]!;
}

async function load(admin: Admin, rows: LeasedPushRow[]): Promise<PushLoad> {
  const users = [...new Set(rows.map((row) => row.user_id))];
  const ids = rows.map((row) => row.notification_id);

  const [notifications, devices, unread] = await Promise.all([
    retryDb(() => admin.from('notifications').select('id, user_id, kind, payload, read_at').in('id', ids)),
    retryDb(() =>
      admin.from('push_devices').select('id, user_id, token, locale, platform').in('user_id', users).is('disabled_at', null),
    ),
    // The badge: the bell's unread count, one small query per person in the batch.
    Promise.all(
      users.map(async (user) => {
        const { count } = await admin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user)
          .is('read_at', null)
          .is('folded_into', null);
        return [user, count ?? 0] as const;
      }),
    ),
  ]);

  const byUser = new Map<string, PushLoad['devices'] extends Map<string, infer V> ? V : never>();
  for (const device of devices ?? []) {
    const list = byUser.get(device.user_id) ?? [];
    list.push(device);
    byUser.set(device.user_id, list);
  }

  return {
    notifications: new Map((notifications ?? []).map((row) => [row.id, row])),
    devices: byUser,
    unread: new Map(unread),
  };
}

function sweepDeps(admin: Admin, deadline: Deadline): PushSweepDeps {
  return {
    lease: async (limit) =>
      (await retryDb(() => admin.rpc('lease_due_pushes', { p_limit: limit, p_lease_seconds: LEASE_SECONDS }))) ?? [],
    settle: async (id, token, outcome, detail) =>
      Boolean(
        await retryDb(() =>
          admin.rpc('settle_push', { p_id: id, p_lock_token: token, p_outcome: outcome, p_detail: detail }),
        ),
      ),
    load: (rows) => load(admin, rows),
    send: (messages) => sendToExpo(messages, { accessToken: accessToken() }),
    keepTickets: async (tickets) => {
      await retryDb(() => admin.from('push_tickets').upsert(tickets, { onConflict: 'ticket_id', ignoreDuplicates: true }));
    },
    disableDevices: (ids, reason) => disableDevices(admin, ids, reason),
    translator,
    deadline,
  };
}

async function disableDevices(admin: Admin, ids: string[], reason: string) {
  await retryDb(() =>
    admin
      .from('push_devices')
      .update({ disabled_at: new Date().toISOString(), disabled_reason: reason })
      .in('id', ids)
      .is('disabled_at', null),
  );
}

function receiptDeps(admin: Admin): ReceiptDeps {
  return {
    dueTickets: async (limit) =>
      (await retryDb(() =>
        admin
          .from('push_tickets')
          .select('ticket_id, device_id')
          .lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
          .order('created_at', { ascending: true })
          .limit(limit),
      )) ?? [],
    receipts: (ids) => receiptsFromExpo(ids, { accessToken: accessToken() }),
    forget: async (ids) => {
      await retryDb(() => admin.from('push_tickets').delete().in('ticket_id', ids));
    },
    disableDevices: (ids, reason) => disableDevices(admin, ids, reason),
  };
}

/** The cron's work: send what is due, read receipts, prune. */
export async function runPushSweep(admin: Admin, deadline: Deadline) {
  const sent = await sweepPushes(sweepDeps(admin, deadline));

  let receipts = { checked: 0, answered: 0, phonesOff: 0 };
  if (!deadline.expired()) {
    try {
      receipts = await checkReceipts(receiptDeps(admin));
    } catch (error) {
      // Receipts wait for the next run; the pushes went.
      logFailure('push', 'receipts could not be read', { message: error instanceof Error ? error.message : String(error) });
    }
  }

  let pruned = 0;
  try {
    pruned = (await retryDb(() => admin.rpc('prune_push_outbox', { p_limit: 5000 }))) ?? 0;
  } catch (error) {
    logFailure('push', 'prune failed', { code: (error as { code?: string } | null)?.code });
  }

  return { ...sent, receipts_checked: receipts.checked, receipts_answered: receipts.answered, receipt_phones_off: receipts.phonesOff, pruned };
}

/**
 * Send what an action just queued, now — called from publish(), in after().
 *
 * Never throws and never waits long: a small batch under an eight-second
 * budget, and whatever it leaves is the minute sweep's. Without a service
 * role key there is nothing it can do, and it says so once in the log.
 */
export async function flushPushes(): Promise<void> {
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }
  try {
    await sweepPushes(sweepDeps(admin, createDeadline(8_000)), { batch: 20 });
  } catch (error) {
    logFailure('push', 'flush failed', { message: error instanceof Error ? error.message : String(error) });
  }
}
