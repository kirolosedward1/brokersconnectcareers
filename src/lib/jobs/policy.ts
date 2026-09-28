/**
 * The rules background work runs by, in one place and with no imports.
 *
 * No imports at all — not even the observe.ts regex — because this file is
 * run directly by `node --experimental-strip-types` in the tests, and that
 * cannot resolve the `@/` alias while tsc refuses the `.ts` extension that
 * would let it. A rule that only the type checker has ever seen is a rule
 * nobody has proved, so the few lines duplicated here are the cheaper side of
 * that trade.
 *
 * Everything in here is a decision rather than an effect: how many times to
 * try, which failures are worth trying again, how long a run may take. The
 * effects — the database calls, the provider calls — live in the files that
 * import these.
 */

/**
 * How many times one message is attempted before it is dead-lettered.
 *
 * Five, spaced by the backoff in record_email_attempt (roughly 10 minutes,
 * 40 minutes, 2h40m, 10h40m), covers a provider outage of most of a day —
 * which is the kind worth riding out — while a message that fails five times
 * over that span is failing for a reason somebody needs to look at. The
 * database holds the same number; this is the copy the runtime can read.
 */
export const MAX_EMAIL_ATTEMPTS = 5;

/**
 * Whether an HTTP failure could plausibly go differently a second time.
 *
 * 4xx is the request being wrong and it will stay wrong — a malformed
 * address, an unverified domain — except the four that are about timing:
 * 408 (too slow), 425 (too early), 429 (too often). Everything 5xx is the
 * other side having a bad minute.
 */
export function classifyHttpStatus(status: number): 'transient' | 'permanent' {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

/** The shape both a PostgrestError and a thrown Error satisfy. */
export type DbErrorLike = { code?: string | null; message?: string | null };

/**
 * A database failure that is about the moment rather than the request.
 *
 * Worth one quick retry in-process: a dropped connection, a serialization
 * failure, a deadlock victim, a pooler that was restarting. Never a
 * constraint violation, a permission refusal or a syntax error — those fail
 * identically every time, and retrying one is three log lines instead of one.
 *
 * PostgREST reports a network failure with no code at all and the fetch
 * error's text as the message, which is why the message is read only when
 * the code is absent: a coded error already said what it was.
 */
export function isTransientDbError(err: DbErrorLike | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? '';

  if (!code) {
    return /fetch failed|network|timed? ?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|other side closed/i.test(
      err.message ?? '',
    );
  }

  // 08 connection exception, 53 insufficient resources (too many
  // connections, out of memory), 40001 serialization failure, 40P01 deadlock,
  // 57P01 admin shutdown, 57014 statement cancelled (a statement timeout).
  if (code.startsWith('08') || code.startsWith('53')) return true;
  if (code === '40001' || code === '40P01' || code === '57P01' || code === '57014') return true;

  // PostgREST's own: could not connect / connection pool exhausted / schema
  // cache not loaded yet — all of them "try again in a moment".
  return /^PGRST00[0-3]$/.test(code);
}

export type RetryOptions = {
  /** Total tries, the first one included. */
  attempts: number;
  /** The first pause; each later one doubles, with jitter. */
  baseMs: number;
  isTransient: (error: unknown) => boolean;
  /** Injected by tests so a retry does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A small in-process retry for transient blips, and only those.
 *
 * Deliberately small: a handful of attempts over well under a second. This is
 * not the retry policy for a message — that lives in the outbox, measured in
 * minutes and hours and surviving a crash. This is for the connection that
 * dropped between two statements of a cron run, which would otherwise fail
 * the whole run for something that was over by the time anyone looked.
 *
 * A permanent error is rethrown on the first try, untouched.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  const attempts = Math.max(1, Math.floor(options.attempts));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !options.isTransient(error)) throw error;
      // Exponential with jitter, so two workers that failed together do not
      // retry together and fail together again.
      const pause = options.baseMs * 2 ** (attempt - 1) * (0.5 + Math.random());
      await sleep(Math.round(pause));
    }
  }
}

/** The retry every database call in background work uses. */
export const DB_RETRY: RetryOptions = {
  attempts: 3,
  baseMs: 150,
  isTransient: (error) =>
    typeof error === 'object' && error !== null && isTransientDbError(error as DbErrorLike),
};

export type Deadline = {
  /** Milliseconds left, never negative. */
  remainingMs(): number;
  expired(): boolean;
};

/**
 * A time budget, so a loop stops by choice rather than by being killed.
 *
 * The platform ends a function at maxDuration mid-statement: no stats, no
 * finished run, a lease left to lapse. A loop that checks this between items
 * stops with its work recorded and says `out_of_time`, which is the
 * difference between "the batch was bigger than one run" and "the job
 * crashed".
 */
export function createDeadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const startedAt = now();
  const remainingMs = () => Math.max(0, budgetMs - (now() - startedAt));
  return { remainingMs, expired: () => remainingMs() <= 0 };
}

/**
 * Text from somewhere else, made fit to store and log.
 *
 * Provider and database error text is diagnostic and occasionally carries an
 * address in the same sentence. The same pattern as observe.withoutAddresses,
 * copied rather than imported for the reason at the top of this file; if one
 * changes, change both.
 */
export function sanitizeError(text: string, max = 300): string {
  const cleaned = String(text)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<address>')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, Math.max(0, max - 1))}…` : cleaned;
}
