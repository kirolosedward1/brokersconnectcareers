import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { notifySecurityAlert, notifySecurityDigest } from '@/lib/email/notify';
import { isoWeek, type SecurityDigest, type SecurityEventRow } from '@/lib/security/alerts';
import { logFailure } from '@/lib/observe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The security watcher: a critical event reaches a person within ten
 * minutes, and on Monday morning the admins get the week in numbers.
 *
 * Every critical security_events row not yet sent (migration 370) is emailed
 * to every admin and SECURITY_ALERT_EMAIL, then marked. A send that fails is
 * left unmarked and tried again on the next run; the outbox's dedupe key is
 * per event and recipient, so a retry after a half-finished run writes to
 * nobody twice. Rows older than a week are no longer offered — an alert that
 * late is history, and /admin/security has it.
 *
 * The digest: on Mondays from 06:00 UTC (08:00 or 09:00 in Cairo), keyed on
 * the ISO week, so the runs after the first that day send nothing new.
 */
export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'security-watch',
    maxDurationSeconds: maxDuration,
    work: async ({ admin }) => {
      const { data, error } = await admin.rpc('security_alerts_due', { p_limit: 20 });
      if (error) throw new Error(`security_alerts_due failed (${error.code ?? 'unknown'})`);
      const due = (data ?? []) as SecurityEventRow[];

      const sent: number[] = [];
      let failed = 0;
      for (const event of due) {
        const outcome = await notifySecurityAlert(event);
        // 'skipped' is "nobody to write to": marked, or it would be offered
        // every ten minutes for a week.
        if (outcome === 'failed') failed += 1;
        else sent.push(event.id);
      }
      if (sent.length) {
        const { error: markError } = await admin.rpc('mark_security_alerted', { p_ids: sent });
        if (markError) logFailure('security-watch', 'could not mark alerts sent', { code: markError.code });
      }

      const now = new Date();
      let digest = 'not_due';
      if (now.getUTCDay() === 1 && now.getUTCHours() >= 6) {
        const { data: summary, error: digestError } = await admin.rpc('security_digest', { p_days: 7 });
        if (digestError) {
          logFailure('security-watch', 'could not sum up the week', { code: digestError.code });
          digest = 'failed';
        } else {
          digest = await notifySecurityDigest(summary as SecurityDigest, isoWeek(now));
        }
      }

      return { due: due.length, alerted: sent.length, failed, digest };
    },
  });
}
