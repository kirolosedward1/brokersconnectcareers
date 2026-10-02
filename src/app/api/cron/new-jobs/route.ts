import type { NextRequest } from 'next/server';
import { runScheduledJob, type ScheduledWork } from '@/lib/jobs/run';
import { retryDb } from '@/lib/jobs/db';
import { createPublicClient } from '@/lib/supabase/public';
import { parseJobFilters, queryJobs } from '@/lib/queries/jobs';
import { queryParams } from '@/lib/saved-search';
import {
  boardSince,
  duePeople,
  DUE_AFTER_HOURS,
  FIRST_LOOK_HOURS,
  lookForNewJobs,
  type LookContext,
} from '@/lib/new-jobs';
import { logFailure } from '@/lib/observe';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Due rows read per page: a person has at most ten searches, so a page is dozens of people. */
const PAGE = 500;
const HOUR_MS = 3_600_000;

/**
 * The daily bell for new listings (migrations 333–334; the rules are
 * lookForNewJobs in src/lib/new-jobs.ts).
 *
 * Person by person, among those with a search that has alerts on and was not
 * looked at in the last DUE_AFTER_HOURS. Each search runs through the board's
 * own parser and query, through the public client as the weekly email's does,
 * so it can only find what its owner could see for themselves. The push
 * follows from the bell (enqueue_push).
 *
 * A run that runs out of time records where it stopped (`resume_after` in its
 * stats), and the next one starts there (duePeople), so nobody is left behind
 * the same people every day.
 */
export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'new-jobs',
    maxDurationSeconds: maxDuration,
    work: async ({ admin, deadline }) => {
      const publicClient = createPublicClient();
      const started = Date.now();
      const resumeAfter = await resumePoint(admin);
      const dueBefore = new Date(started - DUE_AFTER_HOURS * HOUR_MS).toISOString();

      const stats = {
        people: 0,
        searches: 0,
        notified: 0,
        nothing_new: 0,
        /** Today's notification was already written (a second run today). */
        already_today: 0,
        /** Rows whose owner is no longer a candidate. */
        not_candidates: 0,
        errors: 0,
        out_of_time: false,
      };

      const context: LookContext = {
        cursor: new Date(started).toISOString(),
        firstLook: new Date(started - FIRST_LOOK_HOURS * HOUR_MS).toISOString(),
        searches: (person) =>
          retryDb(() =>
            admin
              .from('saved_searches')
              .select('id, label, query, bell_checked_at')
              .eq('candidate_id', person)
              .eq('alerts', true),
          ),
        // As the weekly email's job reads it: a failed read throws, and is
        // never taken for "not a candidate".
        role: async (person) => {
          const { data, error } = await admin.from('profiles').select('role').eq('id', person).maybeSingle();
          if (error) throw error;
          return data?.role ?? null;
        },
        board: async (query, since) => {
          const filters = parseJobFilters(queryParams(query));
          // Newest first, so everything published since the cursor is on the first
          // pages — with no sponsored listing pinned above them, as in the email.
          const jobs = await boardSince(
            (page) => queryJobs({ ...filters, sort: 'newest', page }, publicClient, { pinSponsored: false }),
            since,
          );
          return jobs.map((job) => ({
            id: job.id,
            published_at: job.published_at,
            company: job.company
              ? { slug: job.company.slug, name_ar: job.company.name_ar, name_en: job.company.name_en }
              : null,
          }));
        },
        applied: async (person, jobIds) =>
          (
            await retryDb(() =>
              admin.from('applications').select('job_id').eq('candidate_id', person).in('job_id', jobIds),
            )
          ).map((row) => row.job_id),
        record: (person, notice) =>
          retryDb(() =>
            admin.rpc('record_new_jobs_notification', {
              p_user: person,
              p_payload: notice.payload,
              p_href: notice.href,
            }),
          ),
        advance: async (searchIds, cursor) => {
          const { error } = await admin.from('saved_searches').update({ bell_checked_at: cursor }).in('id', searchIds);
          // Told, but the cursor stayed: tomorrow repeats today's listings
          // once. Logged rather than thrown, so the outcome stays true.
          if (error) logFailure('new-jobs', 'could not advance the cursor', { code: error.code });
        },
        onSearch: () => {
          stats.searches += 1;
        },
      };

      const people = duePeople(
        async (after, through) => {
          const rows = await retryDb(() => {
            let due = admin
              .from('saved_searches')
              .select('candidate_id')
              .eq('alerts', true)
              .or(`bell_checked_at.is.null,bell_checked_at.lt."${dueBefore}"`)
              .order('candidate_id', { ascending: true })
              .limit(PAGE);
            if (after) due = due.gt('candidate_id', after);
            if (through) due = due.lte('candidate_id', through);
            return due;
          });
          return rows.map((row) => row.candidate_id);
        },
        resumeAfter,
        PAGE,
      );

      // The last person this run reached, for the next to start after.
      let reached: string | null = null;
      for (;;) {
        if (deadline.expired()) {
          stats.out_of_time = true;
          break;
        }
        const next = await people.next();
        if (next.done) break;
        const person = next.value;
        reached = person;
        stats.people += 1;
        try {
          stats[await lookForNewJobs(person, context)] += 1;
        } catch (cause) {
          // One person's failure must not stop the run for everyone else;
          // their cursors stay, so the next run tries again.
          stats.errors += 1;
          logFailure('new-jobs', 'a person failed', { code: (cause as { code?: string } | null)?.code });
        }
      }

      return stats.out_of_time && reached ? { ...stats, resume_after: reached } : stats;
    },
  });
}

/**
 * Where the last run stopped, when it ran out of time before the end of the
 * people due: its `resume_after`. Null when it got through them all, or when
 * there is no run to read.
 */
async function resumePoint(admin: Parameters<ScheduledWork>[0]['admin']): Promise<string | null> {
  const { data, error } = await admin
    .from('job_runs')
    .select('stats')
    .eq('job', 'new-jobs')
    .eq('status', 'succeeded')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const at = (data?.stats as { resume_after?: unknown } | undefined)?.resume_after;
  return typeof at === 'string' && /^[0-9a-f-]{36}$/i.test(at) ? at : null;
}
