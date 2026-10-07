import type { Translate } from '@/lib/notifications/title';
import type {
  LeasedPushRow,
  NotificationRow,
  PushDeviceRow,
  PushTicketRow,
  SettlePushOutcome,
} from '@/lib/supabase/database.types';
import type { Deadline } from '@/lib/jobs/policy';
import { composePush } from '@/lib/push/compose';
import { EXPO_SEND_LIMIT, ExpoRefused, ExpoUnavailable, type ExpoMessage, type ExpoReceipt, type ExpoTicket } from '@/lib/push/expo';

/**
 * Sending the queued pushes, with the database and Expo injected.
 *
 * lease_due_pushes() hands out due rows under a token; for each, the
 * notification it is for, the person's working phones and their unread count
 * are read; one message per phone is sent to Expo, a hundred to a request; and
 * every leased row ends in exactly one settle_push():
 *
 *   sent     at least one phone's message was accepted — its ticket is kept
 *            for the receipt check
 *   skipped  nothing to send any more: the notification is gone or already
 *            read, or the person has no phone left
 *   retry    Expo was down, slow or rate-limiting (the row backs off)
 *   failed   Expo refused the message itself and will again
 *
 * A phone Expo says no longer has the app (DeviceNotRegistered) is switched
 * off at once, here or when its receipt comes back (checkReceipts).
 *
 * Pure, with only type imports and the composer, so the tests drive it with
 * fakes under `node --experimental-strip-types`.
 */

export type PushLoad = {
  notifications: Map<string, Pick<NotificationRow, 'id' | 'user_id' | 'kind' | 'payload' | 'read_at'>>;
  /** Working phones, by user. */
  devices: Map<string, Pick<PushDeviceRow, 'id' | 'token' | 'locale' | 'platform'>[]>;
  /** Unread notifications, by user — the badge. */
  unread: Map<string, number>;
};

export type PushSweepDeps = {
  lease(limit: number): Promise<LeasedPushRow[]>;
  settle(id: number, token: string, outcome: SettlePushOutcome, detail: string | null): Promise<boolean>;
  load(rows: LeasedPushRow[]): Promise<PushLoad>;
  send(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  keepTickets(tickets: Pick<PushTicketRow, 'ticket_id' | 'device_id' | 'outbox_id'>[]): Promise<void>;
  disableDevices(ids: string[], reason: string): Promise<void>;
  translator(locale: 'ar' | 'en'): Translate;
  deadline: Deadline;
};

export type PushSweepStats = {
  leased: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
  messages: number;
  phonesOff: number;
};

const DEFAULT_BATCH = 50;

/** Errors in a ticket that mean the phone, not the message, is the problem. */
const GONE = new Set(['DeviceNotRegistered']);
/** Errors worth another try later. */
const TRANSIENT = new Set(['MessageRateExceeded']);

type Planned = { row: LeasedPushRow; messages: { deviceId: string; message: ExpoMessage }[] };

export async function sweepPushes(deps: PushSweepDeps, options: { batch?: number } = {}): Promise<PushSweepStats> {
  const batch = Math.max(1, Math.floor(options.batch ?? DEFAULT_BATCH));
  const stats: PushSweepStats = { leased: 0, sent: 0, skipped: 0, retried: 0, failed: 0, messages: 0, phonesOff: 0 };

  while (!deps.deadline.expired()) {
    const rows = await deps.lease(batch);
    if (rows.length === 0) break;
    stats.leased += rows.length;

    // As in the email sweep: the whole batch is settled even if one row's
    // settle throws, and the first error is raised once it is done.
    let firstError: unknown = null;
    const settle = async (row: LeasedPushRow, outcome: SettlePushOutcome, detail: string | null) => {
      try {
        await deps.settle(row.id, row.lock_token, outcome, detail);
        if (outcome === 'sent') stats.sent += 1;
        else if (outcome === 'skipped') stats.skipped += 1;
        else if (outcome === 'retry') stats.retried += 1;
        else stats.failed += 1;
      } catch (error) {
        firstError ??= error;
      }
    };

    let load: PushLoad;
    try {
      load = await deps.load(rows);
    } catch (error) {
      // Nothing was sent; the rows back off and come round again.
      for (const row of rows) await settle(row, 'retry', 'could not read what to send');
      throw error;
    }

    const planned: Planned[] = [];
    for (const row of rows) {
      const notification = load.notifications.get(row.notification_id);
      if (!notification) {
        await settle(row, 'skipped', 'notification gone');
        continue;
      }
      if (notification.read_at) {
        await settle(row, 'skipped', 'read already');
        continue;
      }
      const phones = load.devices.get(row.user_id) ?? [];
      if (phones.length === 0) {
        await settle(row, 'skipped', 'no phone');
        continue;
      }
      const badge = load.unread.get(row.user_id) ?? 0;
      planned.push({
        row,
        messages: phones.map((phone) => ({
          deviceId: phone.id,
          message: composePush(notification, phone, badge, deps.translator(phone.locale)),
        })),
      });
    }

    // Requests of up to a hundred messages, never splitting one row's phones
    // across two — so a request that fails fails whole rows.
    const groups: Planned[][] = [];
    let current: Planned[] = [];
    let size = 0;
    for (const item of planned) {
      const count = Math.min(item.messages.length, EXPO_SEND_LIMIT);
      if (size + count > EXPO_SEND_LIMIT && current.length) {
        groups.push(current);
        current = [];
        size = 0;
      }
      current.push({ ...item, messages: item.messages.slice(0, EXPO_SEND_LIMIT) });
      size += count;
    }
    if (current.length) groups.push(current);

    for (const group of groups) {
      const messages = group.flatMap((item) => item.messages.map((entry) => entry.message));
      let tickets: ExpoTicket[];
      try {
        tickets = await deps.send(messages);
        stats.messages += messages.length;
      } catch (error) {
        const outcome: SettlePushOutcome = error instanceof ExpoRefused ? 'failed' : 'retry';
        const detail = error instanceof ExpoRefused || error instanceof ExpoUnavailable ? error.message : 'send failed';
        for (const item of group) await settle(item.row, outcome, detail);
        continue;
      }

      let index = 0;
      const keep: Pick<PushTicketRow, 'ticket_id' | 'device_id' | 'outbox_id'>[] = [];
      const off: string[] = [];
      const outcomes: { item: Planned; outcome: SettlePushOutcome; detail: string | null }[] = [];

      for (const item of group) {
        let ok = 0;
        let gone = 0;
        let transient = 0;
        let lastError: string | null = null;
        for (const entry of item.messages) {
          const ticket = tickets[index];
          index += 1;
          if (ticket?.status === 'ok') {
            ok += 1;
            keep.push({ ticket_id: ticket.id, device_id: entry.deviceId, outbox_id: item.row.id });
            continue;
          }
          const code = ticket?.details?.error ?? 'unknown';
          lastError = code;
          if (GONE.has(code)) {
            gone += 1;
            off.push(entry.deviceId);
          } else if (TRANSIENT.has(code)) {
            transient += 1;
          }
        }

        const outcome: SettlePushOutcome =
          ok > 0 ? 'sent' : gone === item.messages.length ? 'skipped' : transient > 0 ? 'retry' : 'failed';
        outcomes.push({ item, outcome, detail: ok > 0 ? null : lastError });
      }

      if (keep.length) {
        try {
          await deps.keepTickets(keep);
        } catch (error) {
          // A lost ticket only means a dead phone is noticed on the next send
          // instead of from its receipt; the pushes themselves went out.
          firstError ??= error;
        }
      }
      if (off.length) {
        try {
          await deps.disableDevices(off, 'DeviceNotRegistered');
          stats.phonesOff += off.length;
        } catch (error) {
          firstError ??= error;
        }
      }
      for (const { item, outcome, detail } of outcomes) await settle(item.row, outcome, detail);
    }

    if (firstError !== null) throw firstError;
    if (rows.length < batch) break;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export type ReceiptDeps = {
  /** Tickets old enough to have a receipt (fifteen minutes and more), oldest first; `created_at` is when the push went out. */
  dueTickets(limit: number): Promise<Pick<PushTicketRow, 'ticket_id' | 'device_id' | 'created_at'>[]>;
  receipts(ids: string[]): Promise<Record<string, ExpoReceipt>>;
  forget(ids: string[]): Promise<void>;
  /**
   * Switches the phone off unless it was registered again after `since` (its
   * row's last_seen_at). True if it was switched off.
   */
  disableUnseenSince(id: string, since: string, reason: string): Promise<boolean>;
};

/**
 * Phones switched off at once. Each has its own "since", so it is a statement
 * apiece; one after another, the hundreds a broadcast to people who deleted
 * the app brings back could outlast the run, and then the same tickets are
 * read and the same phones patched again next minute.
 */
const PHONES_AT_ONCE = 10;

export type ReceiptStats = { checked: number; answered: number; phonesOff: number };

/**
 * Receipts, read once they exist: a phone Apple says no longer has the app is
 * switched off, so nothing is sent to it again — unless it has been registered
 * since the refused push went out. A receipt is read fifteen minutes and more
 * later, and by then the token may be the next person's on that phone
 * (register_push_device moves a token and keeps its row, and a phone signed
 * out locally answers "not registered" until it registers again); switching
 * it off would leave them without pushes until the app next starts. A ticket
 * whose receipt came back is forgotten; one without a receipt yet is asked
 * about next time, until the prune takes it after two days.
 */
export async function checkReceipts(deps: ReceiptDeps, options: { limit?: number } = {}): Promise<ReceiptStats> {
  const tickets = await deps.dueTickets(Math.max(1, Math.min(options.limit ?? 300, 1000)));
  if (tickets.length === 0) return { checked: 0, answered: 0, phonesOff: 0 };

  const receipts = await deps.receipts(tickets.map((ticket) => ticket.ticket_id));
  const answered: string[] = [];
  // Each phone with its last refused push: registered again after that, it stays on.
  const off = new Map<string, string>();
  for (const ticket of tickets) {
    const receipt = receipts[ticket.ticket_id];
    if (!receipt) continue;
    answered.push(ticket.ticket_id);
    if (receipt.status !== 'error' || !GONE.has(receipt.details?.error ?? '')) continue;
    const since = off.get(ticket.device_id);
    if (!since || Date.parse(ticket.created_at) > Date.parse(since)) off.set(ticket.device_id, ticket.created_at);
  }

  // Counted as the database answers: a phone registered again since is not switched off.
  let phonesOff = 0;
  const phones = [...off];
  for (let start = 0; start < phones.length; start += PHONES_AT_ONCE) {
    const switched = await Promise.all(
      phones
        .slice(start, start + PHONES_AT_ONCE)
        .map(([id, since]) => deps.disableUnseenSince(id, since, 'DeviceNotRegistered')),
    );
    phonesOff += switched.filter(Boolean).length;
  }
  if (answered.length) await deps.forget(answered);
  return { checked: tickets.length, answered: answered.length, phonesOff };
}
