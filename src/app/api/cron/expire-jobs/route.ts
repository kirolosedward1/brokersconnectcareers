import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { retryDb } from '@/lib/jobs/db';
import type { Deadline } from '@/lib/jobs/policy';
import type { createAdminClient } from '@/lib/supabase/admin';
import { EXPIRY_WARN_DAYS, jobExpiryKey, notifyJobExpiry } from '@/lib/email/notify';
import { logFailure } from '@/lib/observe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Nightly: flip active -> expired for anything past its 30-day window, drop
 * featured placements whose 14 days are up, and tell the employers.
 *
 * A listing that expires silently is the worst version of this: the applicants
 * simply stop, the employer assumes the market went quiet, and the one action
 * that would fix it — reposting — is the one nobody thinks to take. So two
 * messages, both bounded:
 *
 *   up to three days out — while there is still time to renew or hire
 *   once it has expired  — with the count of who did apply, and a way back
 *
 * Both are asked as a state, not as "what changed since the last run". The
 * old windows were one day wide (expired in the last 24 hours; expiring
 * between two and three days out), so a run that was missed or ran late
 * skipped every listing that crossed the band in between — silently, since a
 * skipped listing looks exactly like one with nothing to say. Now: every
 * active listing expiring within three days, every expired one within the
 * last seven. The same listing is in the window on several nights, and that
 * is safe: the dedupe key carries the listing's expires_at, so it is one
 * message however many runs see it, and a renewed listing that expires again
 * is a new message.
 *
 * The relabelling also runs hourly from /api/cron/maintenance, so a listing's
 * status lags its expiry by at most an hour; this run's call is what makes
 * the notices below see tonight's expiries even if that one has not run.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; runScheduledJob
 * checks it, takes the job's lease and records the run.
 */

/** How much warning is useful: long enough to act, short enough to be urgent. */
const WARN_DAYS = EXPIRY_WARN_DAYS;
/** How far back a missed "it has expired" notice is still worth sending. */
const CATCH_UP_DAYS = 7;
/** Notices per stage, per run, counting only listings still owed one. More is next night's. */
const CAP = 200;
/**
 * How many listings per stage are looked at to find those CAP. Cheap — an id
 * and a date each — and wide enough that a week of listings already told does
 * not crowd out the ones that are not.
 */
const SCAN = 1000;
/** Dedupe keys per lookup, so the query string stays well inside URL limits. */
const KEY_CHUNK = 50;

const DAY_MS = 86_400_000;

type Admin = ReturnType<typeof createAdminClient>;

export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'expire-jobs',
    maxDurationSeconds: maxDuration,
    work: async ({ admin, deadline }) => {
      // The relabel is the half that must happen. A failure here fails the
      // run — recorded, logged, and visible on /admin/operations — rather than
      // sending notices about a state that was not reached.
      const expired = (await retryDb(() => admin.rpc('expire_stale_jobs'))) ?? 0;

      const now = Date.now();

      /*
        Who is still owed a notice, not everyone in the window.

        A listing stays in its window for several nights after it has been
        told, and the claim that makes the repeat harmless is the last step of
        notifyJobExpiry — after a count and three lookups. Selected first and
        capped, the listings already told filled the cap and the time budget
        every night, and the ones not yet told waited behind them: an
        "expired" notice days late, a warning shortened to hours. So the
        window is scanned wide, the listings whose key is already held are
        passed over (one indexed lookup per fifty), and the cap and the budget
        go to what is left.

        Expiring soonest first: the nearest deadline is the most urgent
        warning. Expired newest first: tonight's expiries are never behind a
        backlog, and older ones missed by a skipped night fill the room left.
      */
      const expiringSoon = await retryDb(() =>
        admin
          .from('jobs')
          .select('id, expires_at')
          .eq('status', 'active')
          .gt('expires_at', new Date(now).toISOString())
          .lte('expires_at', new Date(now + WARN_DAYS * DAY_MS).toISOString())
          .order('expires_at', { ascending: true })
          .limit(SCAN),
      );

      const recentlyExpired = await retryDb(() =>
        admin
          .from('jobs')
          .select('id, expires_at')
          .eq('status', 'expired')
          .gte('expires_at', new Date(now - CATCH_UP_DAYS * DAY_MS).toISOString())
          .lte('expires_at', new Date(now).toISOString())
          .order('expires_at', { ascending: false })
          .limit(SCAN),
      );

      const stats = { warned: 0, closed: 0, skipped_on_error: 0, out_of_time: false };
      const owedWarning = await stillOwed(admin, expiringSoon ?? [], 'expiring');
      const owedClosing = await stillOwed(admin, recentlyExpired ?? [], 'expired');
      await notifyAll(admin, deadline, owedWarning, 'expiring', stats);
      await notifyAll(admin, deadline, owedClosing, 'expired', stats);

      return { expired, ...stats };
    },
  });
}

/**
 * The listings in `jobs` whose notice for this stage has no outbox row yet,
 * in the same order, at most CAP of them.
 *
 * Any row at all counts as "told": sent, retrying, dead-lettered or refused
 * — claim_email would hand back nothing for every one of them, so sending
 * would be skipped anyway, only later and at more cost. A lookup that fails is
 * not a reason to skip anybody: that chunk is kept, and the claim decides.
 */
async function stillOwed(
  admin: Admin,
  jobs: { id: string; expires_at: string | null }[],
  stage: 'expiring' | 'expired',
): Promise<{ id: string }[]> {
  const owed: { id: string }[] = [];
  for (let i = 0; i < jobs.length && owed.length < CAP; i += KEY_CHUNK) {
    const chunk = jobs.slice(i, i + KEY_CHUNK);
    const keys = chunk.map((job) => jobExpiryKey(stage, job.id, job.expires_at));
    const { data, error } = await admin.from('email_log').select('dedupe_key').in('dedupe_key', keys);
    if (error) {
      logFailure('cron', 'could not check which expiry notices went', { stage, code: error.code });
    }
    const held = new Set((data ?? []).map((row) => row.dedupe_key));
    for (const [index, job] of chunk.entries()) {
      if (owed.length >= CAP) break;
      if (!held.has(keys[index])) owed.push({ id: job.id });
    }
  }
  return owed;
}

async function notifyAll(
  admin: Admin,
  deadline: Deadline,
  jobs: { id: string }[],
  stage: 'expiring' | 'expired',
  stats: { warned: number; closed: number; skipped_on_error: number; out_of_time: boolean },
): Promise<void> {
  for (const job of jobs) {
    // Stopping is safe: whatever is left is still in tomorrow's window, and —
    // having no outbox row — still first in line for it.
    if (deadline.expired()) {
      stats.out_of_time = true;
      return;
    }

    // Sequential on purpose. This runs at 1am against a provider with a rate
    // limit, and a hundred parallel sends is how a nightly job earns a 429 for
    // every message after the tenth.
    const { count, error } = await admin
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', job.id);

    // Not sent rather than sent wrong. "Nobody applied" to an employer who
    // had forty applicants is worse than a notice a night late — and this
    // listing is still in the window tomorrow.
    if (error || count === null) {
      stats.skipped_on_error += 1;
      logFailure('cron', 'could not count applicants for an expiry notice', {
        job: job.id,
        stage,
        code: error?.code,
      });
      continue;
    }

    const outcome = await notifyJobExpiry(job.id, stage, count);
    if (outcome === 'sent') {
      if (stage === 'expiring') stats.warned += 1;
      else stats.closed += 1;
    }
  }
}
