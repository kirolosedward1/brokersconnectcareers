import { useQuery } from '@tanstack/react-query';
import type { AdminMailStatus } from '@/lib/mobile-api/reads';
import type {
  AbuseLimitRow,
  AuditLogRow,
  EmailActivityRow,
  EmailDeadLetterRow,
  EmailStatus,
  JobRunRow,
  OutboxOverview,
  ScheduledJobOverviewRow,
  SecurityEventRow,
  SecuritySummary,
} from '@/lib/supabase/database.types';
import { getJson } from '~/lib/api';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * The console's read-mostly pages — the website's /admin/email,
 * /admin/operations and /admin/security — as the app reads them: the same
 * admin-only functions and tables, under the admin's own session, and only
 * through the open door (record.ts). Every read throws when it fails: an
 * empty outbox, no dead letters and a quiet security log are the answers an
 * admin acts on by going away, and a read that failed must never produce them
 * (the website's must()). Keyed under ['admin'], which every lever invalidates.
 */

/** The email page's chips, in the website's order; `all` is the whole outbox. */
export const EMAIL_FILTERS: readonly (EmailStatus | 'all')[] = [
  'all',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'failed',
  'suppressed',
  'cancelled',
];

/** Scheduled jobs in schedule order (vercel.json): the spine, which the database fills. */
export const EXPECTED_JOBS = ['expire-jobs', 'email-retry', 'daily-digest', 'job-alerts', 'new-jobs'] as const;

/**
 * Whether this deployment can send mail, and the names of the variables in
 * the way when it cannot — from /api/mobile/v1/admin/mail, an admin's alone
 * behind the website's door, because a phone cannot look at the server's
 * environment. Kept five minutes: it changes only with a deploy.
 */
export function useMailStatus() {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'mail'],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: () => getJson<AdminMailStatus>('/api/mobile/v1/admin/mail', { signedIn: true }),
  });
}

/** How many emails are in each state, 30 days (email_activity_summary). */
export function useEmailSummary() {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'email', 'summary'],
    enabled: open,
    queryFn: async (): Promise<{ counts: Map<EmailStatus, number>; total: number }> => {
      const { data, error } = await supabase.rpc('email_activity_summary');
      if (error) throw error;
      const counts = new Map((data ?? []).map((row) => [row.status, Number(row.count)] as const));
      return { counts, total: [...counts.values()].reduce((sum, value) => sum + value, 0) };
    },
  });
}

/**
 * What happened to the emails, newest first (email_activity, 200 rows, one
 * state or all): the one place in the console a recipient's address appears,
 * as on the website — the question it answers is "did mine go".
 */
export function useEmailActivity(status: EmailStatus | null) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'email', 'activity', status],
    enabled: open,
    queryFn: async (): Promise<EmailActivityRow[]> => {
      const { data, error } = await supabase.rpc('email_activity', { p_limit: 200, p_status: status });
      if (error) throw error;
      return (data ?? []) as EmailActivityRow[];
    },
  });
}

export type Operations = {
  /** Every scheduled job, the expected ones first in schedule order, a job that has never run with no row. */
  jobs: { job: string; row: ScheduledJobOverviewRow | null }[];
  outbox: OutboxOverview | null;
  dead: EmailDeadLetterRow[];
  runs: JobRunRow[];
};

/** The background work (the website's /admin/operations): four reads, in one go, all or nothing. */
export function useOperations() {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'operations'],
    enabled: open,
    queryFn: async (): Promise<Operations> => {
      const [overview, outbox, dead, runs] = await Promise.all([
        supabase.rpc('scheduled_job_overview'),
        supabase.rpc('outbox_overview'),
        supabase.rpc('email_dead_letters', { p_limit: 100 }),
        supabase.rpc('recent_job_runs', { p_limit: 50 }),
      ]);
      if (overview.error) throw overview.error;
      if (outbox.error) throw outbox.error;
      if (dead.error) throw dead.error;
      if (runs.error) throw runs.error;
      const rows = (overview.data ?? []) as ScheduledJobOverviewRow[];
      const byJob = new Map(rows.map((row) => [row.job, row]));
      // A job that has never recorded a run is absent from the overview, and
      // on a table of what ran that reads as "nothing to see" — when a cron
      // that was never wired up is the most important thing the page can show.
      const expected: readonly string[] = EXPECTED_JOBS;
      const jobs = [...expected, ...rows.map((row) => row.job).filter((job) => !expected.includes(job))].map((job) => ({
        job,
        row: byJob.get(job) ?? null,
      }));
      return {
        jobs,
        outbox: ((outbox.data ?? []) as OutboxOverview[])[0] ?? null,
        dead: (dead.data ?? []) as EmailDeadLetterRow[],
        runs: (runs.data ?? []) as JobRunRow[],
      };
    },
  });
}

export type Security = {
  summary: SecuritySummary;
  events: SecurityEventRow[];
  audit: AuditLogRow[];
  limits: AbuseLimitRow[];
};

/**
 * What the platform noticed in the last day and who decided what (the
 * website's /admin/security): the summary, the latest fifty events, the
 * latest fifty rows of the audit trail, and the limits the database enforces
 * — read, never changed, from here.
 */
export function useSecurity() {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'security'],
    enabled: open,
    queryFn: async (): Promise<Security> => {
      const [summary, events, audit, limits] = await Promise.all([
        supabase.rpc('security_summary'),
        supabase.from('security_events').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('abuse_limits').select('*').order('key'),
      ]);
      if (summary.error) throw summary.error;
      if (events.error) throw events.error;
      if (audit.error) throw audit.error;
      if (limits.error) throw limits.error;
      return {
        summary: summary.data as SecuritySummary,
        events: (events.data ?? []) as SecurityEventRow[],
        audit: (audit.data ?? []) as AuditLogRow[],
        limits: (limits.data ?? []) as AbuseLimitRow[],
      };
    },
  });
}
