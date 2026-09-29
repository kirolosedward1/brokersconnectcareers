/**
 * The Expo push service, the only thing the website talks to about phones.
 *
 * Expo holds the Apple (and later Google) credentials and forwards each
 * message; the website sends it JSON and gets back a ticket per message, then,
 * a quarter of an hour or more later, a receipt per ticket saying whether
 * Apple took it. EXPO_ACCESS_TOKEN authenticates the project when the Expo
 * account turns on "enhanced push security"; without it Expo accepts any
 * sender that knows a token, which is how the app's own tokens stay private.
 *
 * No `server-only`, and fetch injected: the sweep's tests drive this with a
 * stand-in Expo under `node --experimental-strip-types`.
 */

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo takes at most this many messages per request, and this many ids per receipt request. */
export const EXPO_SEND_LIMIT = 100;
export const EXPO_RECEIPT_LIMIT = 1000;

export type ExpoMessage = {
  to: string;
  body: string;
  title?: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  badge?: number;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  /** Seconds Apple should keep trying a phone that is off; a notice a day old is not news. */
  ttl?: number;
};

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: 'ok' }
  | { status: 'error'; message?: string; details?: { error?: string } };

/** Expo did not answer as it should: down, slow, or rate-limiting. Try again later. */
export class ExpoUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpoUnavailable';
  }
}

/** Expo refused the request as a whole: a bad access token, a malformed batch. Retrying will not help. */
export class ExpoRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpoRefused';
  }
}

type Options = { accessToken?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number };

async function post(url: string, body: unknown, { accessToken, fetchImpl = fetch, timeoutMs = 10_000 }: Options) {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ExpoUnavailable(`network: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status === 429 || response.status >= 500) {
    throw new ExpoUnavailable(`HTTP ${response.status}`);
  }
  const json = (await response.json().catch(() => null)) as { data?: unknown; errors?: { code?: string }[] } | null;
  if (!response.ok) {
    throw new ExpoRefused(`HTTP ${response.status} ${json?.errors?.[0]?.code ?? ''}`.trim());
  }
  if (!json || json.data === undefined) throw new ExpoUnavailable('an answer without data');
  return json.data;
}

/** One ticket per message, in the order sent. */
export async function sendToExpo(messages: ExpoMessage[], options: Options = {}): Promise<ExpoTicket[]> {
  if (messages.length === 0) return [];
  if (messages.length > EXPO_SEND_LIMIT) throw new ExpoRefused(`more than ${EXPO_SEND_LIMIT} messages in one request`);
  const data = await post(EXPO_SEND_URL, messages, options);
  if (!Array.isArray(data) || data.length !== messages.length) {
    throw new ExpoUnavailable('an answer that does not match what was sent');
  }
  return data as ExpoTicket[];
}

/** Receipts by ticket id; a ticket with no receipt yet is simply absent. */
export async function receiptsFromExpo(ids: string[], options: Options = {}): Promise<Record<string, ExpoReceipt>> {
  if (ids.length === 0) return {};
  const data = await post(EXPO_RECEIPTS_URL, { ids: ids.slice(0, EXPO_RECEIPT_LIMIT) }, options);
  return data && typeof data === 'object' ? (data as Record<string, ExpoReceipt>) : {};
}
