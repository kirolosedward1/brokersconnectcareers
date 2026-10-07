import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { retryDb } from '@/lib/jobs/db';
import { createPublicClient } from '@/lib/supabase/public';
import { localized } from '@/i18n/routing';
import { parseJobFilters, queryJobs } from '@/lib/queries/jobs';
import { queryParams } from '@/lib/saved-search';
import { sendSavedSearchDigest } from '@/lib/email/notify';
import { logFailure } from '@/lib/observe';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Searches fetched per query. The loop keeps fetching until none are due or time is up. */
const BATCH = 100;
/** Roles listed in a single email before it becomes a wall. */
const MAX_JOBS = 8;
/** A first-time send looks back this far rather than over all history. */
const FIRST_RUN_WINDOW_DAYS = 7;
/**
 * A search checked more recently than this is not due. Less than a week, so
 * next Monday's first run finds everything this Monday's runs got to; more
 * than a day, so this Monday's later runs do not look at it again.
 */
const DUE_AFTER_DAYS = 5;

const DAY_MS = 86_400_000;

/**
 * Weekly saved-search alerts.
 *
 * Runs each candidate's own saved filters through the same parser and the same
 * query the jobs page uses, so what lands in the inbox is exactly what they
 * would see if they opened the link. There is no second implementation of the
 * filter model to drift out of step.
 *
 * The search runs through the *public* client, not the service role. A digest
 * must never contain a listing the recipient could not see for themselves, and
 * the cleanest way to guarantee that is to look with the same eyes the public
 * has.
 *
 * last_sent_at is advanced only when a message actually goes out. A week with
 * no new matches leaves the mark where it was, so nothing is skipped over.
 *
 * last_checked_at is the job's cursor, and it advances whenever a search was
 * looked at and answered — sent, nothing new, or not a candidate's. It used to
 * be missing: the job took 200 searches ordered by last_sent_at, and a search
 * with nothing new never moved, so beyond 200 the same searches were checked
 * every week and the rest never were. Now the least recently checked go
 * first, a checked one goes to the back of the line, and the loop keeps
 * taking batches until nothing is due or the time budget is spent — with
 * several runs on Monday morning (vercel.json) to pick up where the last one
 * stopped. A search that throws keeps its old mark and is retried by the next
 * run, not dropped for the week.
 */
export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'job-alerts',
    maxDurationSeconds: maxDuration,
    work: async ({ admin, deadline }) => {
      const publicClient = createPublicClient();
      const firstRunCutoff = new Date(Date.now() - FIRST_RUN_WINDOW_DAYS * DAY_MS).toISOString();
      const dueBefore = new Date(Date.now() - DUE_AFTER_DAYS * DAY_MS).toISOString();

      const stats = {
        considered: 0,
        sent: 0,
        nothing_new: 0,
        /** Rows whose owner is no longer somebody this digest is written for. */
        not_candidates: 0,
        errors: 0,
        out_of_time: false,
      };

      /*
        Searches still due that this run has already tried and will not try
        again: the ones that threw, and any whose cursor write failed. A
        checked search leaves the due set; these stay in it.

        Every batch is read from the front of the due set, widened by exactly
        that many rows, and filtered through `seen`. Not an offset: the set
        changes while the run walks it, and a search created mid-run sorts
        ahead of the stuck rows (null last_checked_at first), so skipping
        `stuck` rows would skip *it* instead of them. Reading from the front
        costs `stuck` extra rows per batch and cannot jump anything.
      */
      let stuck = 0;
      const seen = new Set<string>();

      batches: for (;;) {
        if (deadline.expired()) {
          stats.out_of_time = true;
          break;
        }

        const searches =
          (await retryDb(() =>
            admin
              .from('saved_searches')
              .select('id, candidate_id, label, query, last_sent_at')
              .eq('alerts', true)
              .or(`last_checked_at.is.null,last_checked_at.lt."${dueBefore}"`)
              .order('last_checked_at', { ascending: true, nullsFirst: true })
              .order('id', { ascending: true })
              .range(0, stuck + BATCH - 1),
          )) ?? [];

        const fresh = searches.filter((search) => !seen.has(search.id));
        if (fresh.length === 0) break;

        for (const search of fresh) {
          if (deadline.expired()) {
            stats.out_of_time = true;
            break batches;
          }
          seen.add(search.id);
          stats.considered += 1;

          let sent = false;
          // When the board was read: what this digest covers runs up to here,
          // so it is where the next one starts. Stamped after the send, as it
          // was, a listing published while this one was being put together
          // fell between the two — not in this digest, and before the next
          // one's start — and was never sent to this search at all.
          let lookedAt: string | null = null;
          try {
            const since = search.last_sent_at ?? firstRunCutoff;
            const filters = parseJobFilters(queryParams(search.query));

            lookedAt = new Date().toISOString();
            // Newest first, so everything published since the cutoff is at the top
            // — and only newest first: no sponsored listing pinned above them,
            // which would take a place on the page and lead an email that has
            // no "sponsored" label to give it.
            const { jobs } = await queryJobs({ ...filters, sort: 'newest', page: 1 }, publicClient, {
              pinSponsored: false,
            });

            const matches = jobs
              .filter((job) => job.published_at && job.published_at > since)
              .slice(0, MAX_JOBS);

            if (matches.length === 0) {
              stats.nothing_new += 1;
            } else {
              /*
                The owner's language, and whether they are still somebody this mail is
                for.

                The insert policy now refuses a saved search to anyone but a candidate,
                and migration 65 removed the rows employers had already accumulated —
                but a role is not frozen. An admin moving an account from candidate to
                employer leaves rows that were created legitimately and are now
                unreachable to their owner, and the digest is the one thing that would
                still reach *them*: it is worded for somebody looking for work, and the
                only page with the switch to stop it turns employers away.

                Skipped rather than deleted. The row is the person's, not this job's to
                throw away, and last_sent_at is untouched by a skip — so if they are
                moved back, the week they missed is still there to cover.

                A read that *fails* is not a skip any more: it throws, so the search
                keeps its place in the line and the next run asks again. Treating it
                as "not a candidate" would now advance the cursor past a week that
                was never looked at.
              */
              const { data: profile, error: profileError } = await admin
                .from('profiles')
                .select('role, locale')
                .eq('id', search.candidate_id)
                .maybeSingle();
              if (profileError) throw profileError;

              if (profile?.role !== 'candidate') {
                stats.not_candidates += 1;
              } else {
                const locale = profile.locale === 'en' ? 'en' : 'ar';

                const outcome = await sendSavedSearchDigest({
                  userId: search.candidate_id,
                  searchId: search.id,
                  label: search.label,
                  query: search.query,
                  jobs: matches.map((job) => ({
                    title: localized(locale, job.title_ar, job.title_en),
                    company: localized(locale, job.company?.name_ar, job.company?.name_en),
                    slug: job.slug,
                  })),
                });

                sent = outcome === 'sent';
                if (sent) stats.sent += 1;
              }
            }
          } catch (cause) {
            // One bad saved search must not stop the run for everyone else. Its
            // cursor is left alone, so a later run tries it again.
            stats.errors += 1;
            stuck += 1;
            logFailure('job-alerts', 'search failed', {
              search: search.id,
              code: (cause as { code?: string } | null)?.code,
            });
            continue;
          }

          // last_sent_at only on a real send. A skip because the recipient
          // turned digests off must not silently consume the window they would
          // have covered.
          const at = new Date().toISOString();
          const { error: markError } = await admin
            .from('saved_searches')
            .update(sent ? { last_checked_at: at, last_sent_at: lookedAt ?? at } : { last_checked_at: at })
            .eq('id', search.id);

          if (markError) {
            // Still due, so still at the front of the line: count it with the
            // ones that threw, or the next batch would start on it again.
            stuck += 1;
            logFailure('job-alerts', 'could not advance the cursor', {
              search: search.id,
              code: markError.code,
            });
          }
        }

        // A short batch was the end of the due set.
        if (searches.length < BATCH) break;
      }

      return stats;
    },
  });
}
