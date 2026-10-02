import type { Deadline } from './policy';

/**
 * One scheduled run, from lease to result, with every effect injected.
 *
 * The shape every cron route now shares: take the job's lease, do the work
 * inside a time budget, write down how it went, answer. Written once so that
 * the five routes cannot drift into five slightly different ideas of what a
 * failed run is — which is how the old ones ended up with one answering
 * `{ error: error.message }`, one a bare 503 and one nothing at all.
 *
 * Pure, with only type imports, because the tests run it directly under
 * `node --experimental-strip-types` with fake begin/finish/work functions and
 * a fake clock. run.ts is the thin half that wires it to Postgres.
 *
 * The rules:
 *
 *   skipped  — another run holds the lease. 200, because Vercel Cron treats
 *              anything else as a failure to alert on, and a run that
 *              correctly stood aside is not one.
 *   503      — the lease could not even be asked for. Nothing ran.
 *   500      — the work threw. The response says `failed` and never the
 *              message: this endpoint answers to anyone who can reach it, and
 *              the reason is in the job_runs row and the log for whoever is
 *              allowed to read it.
 *   finish   — failing to write the run's end is logged and never changes
 *              the answer. The work happened (or did not) either way, and a
 *              run left `running` is closed as failed by the next begin once
 *              its lease lapses, so nothing stays wrong for long.
 */

/** Counts and flags — and, for a job that resumes, an id saying where (new-jobs' resume_after). */
export type JobStats = Record<string, number | boolean | string>;

export type JobLogDetail = Record<string, string | number | boolean | null | undefined>;

export type JobContext = {
  runId: string;
  deadline: Deadline;
};

export type JobRunDeps = {
  job: string;
  leaseSeconds: number;
  budgetMs: number;
  /** The run id, or null when another live run holds the lease. Throws when the database cannot answer. */
  begin(job: string, leaseSeconds: number): Promise<string | null>;
  finish(
    id: string,
    status: 'succeeded' | 'failed',
    stats: JobStats,
    error: string | null,
  ): Promise<boolean>;
  work(ctx: JobContext): Promise<JobStats>;
  log(event: 'started' | 'completed' | 'failed' | 'skipped', detail: JobLogDetail): void;
  now(): number;
};

export type JobRunResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export async function executeJobRun(deps: JobRunDeps): Promise<JobRunResult> {
  const { job } = deps;
  const startedAt = deps.now();

  let runId: string | null;
  try {
    runId = await deps.begin(job, deps.leaseSeconds);
  } catch (error) {
    deps.log('failed', { job, stage: 'begin', error: describe(error) });
    return { httpStatus: 503, body: { job, error: 'unavailable' } };
  }

  if (!runId) {
    deps.log('skipped', { job, reason: 'already_running' });
    return { httpStatus: 200, body: { job, skipped: 'already_running' } };
  }

  deps.log('started', { job, run: runId });

  // Built here rather than imported from policy.ts, for the same reason that
  // file has no imports: a runtime import is one this file cannot be tested
  // through. It is four lines.
  const budgetMs = deps.budgetMs;
  const remainingMs = () => Math.max(0, budgetMs - (deps.now() - startedAt));
  const deadline: Deadline = { remainingMs, expired: () => remainingMs() <= 0 };

  let stats: JobStats;
  try {
    stats = await deps.work({ runId, deadline });
  } catch (error) {
    const reason = describe(error);
    const ms = deps.now() - startedAt;
    deps.log('failed', { job, run: runId, duration_ms: ms, error: reason });
    await finishQuietly(deps, runId, 'failed', {}, reason);
    return { httpStatus: 500, body: { job, run: runId, error: 'failed' } };
  }

  const ms = deps.now() - startedAt;
  deps.log('completed', { job, run: runId, duration_ms: ms, ...stats });
  await finishQuietly(deps, runId, 'succeeded', stats, null);
  return { httpStatus: 200, body: { job, run: runId, ...stats, ms } };
}

async function finishQuietly(
  deps: JobRunDeps,
  runId: string,
  status: 'succeeded' | 'failed',
  stats: JobStats,
  error: string | null,
): Promise<void> {
  try {
    const closed = await deps.finish(runId, status, stats, error);
    // False means the row was no longer `running`: the lease lapsed and a
    // later begin already closed it as failed. Worth knowing — the budget is
    // shorter than the lease precisely so that this does not happen.
    if (!closed) deps.log('failed', { job: deps.job, run: runId, stage: 'finish', error: 'run was no longer open' });
  } catch (cause) {
    deps.log('failed', { job: deps.job, run: runId, stage: 'finish', error: describe(cause) });
  }
}

/**
 * An error as text fit for a log line and the job_runs row: the code when
 * there is one, the message, and no address. The pattern is observe.ts's,
 * duplicated for the reason given above.
 */
function describe(error: unknown): string {
  let text: string;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    text = typeof code === 'string' && code ? `${code}: ${error.message}` : error.message;
  } else if (typeof error === 'object' && error !== null && 'message' in error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    text = typeof code === 'string' && code ? `${code}: ${String(message)}` : String(message);
  } else {
    text = String(error);
  }

  const cleaned = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<address>')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 299)}…` : cleaned;
}
