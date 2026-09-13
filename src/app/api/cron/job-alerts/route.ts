import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPublicClient } from '@/lib/supabase/public';
import { env } from '@/lib/env';
import { localized } from '@/i18n/routing';
import { parseJobFilters, queryJobs } from '@/lib/queries/jobs';
import { sendSavedSearchDigest } from '@/lib/email/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** How many searches one invocation will process. */
const BATCH = 200;
/** Roles listed in a single email before it becomes a wall. */
const MAX_JOBS = 8;
/** A first-time send looks back this far rather than over all history. */
const FIRST_RUN_WINDOW_DAYS = 7;

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
 */
export async function GET(request: NextRequest) {
  const secret = env.cronSecret;
  const authorization = request.headers.get('authorization');

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const { data: searches, error } = await admin
    .from('saved_searches')
    .select('id, candidate_id, label, query, last_sent_at')
    .eq('alerts', true)
    .order('last_sent_at', { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const publicClient = createPublicClient();
  const firstRunCutoff = new Date(
    Date.now() - FIRST_RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let sent = 0;
  let empty = 0;
  /** Rows whose owner is no longer somebody this digest is written for. */
  let notForCandidates = 0;

  for (const search of searches ?? []) {
    try {
      const since = search.last_sent_at ?? firstRunCutoff;
      const filters = parseJobFilters(Object.fromEntries(new URLSearchParams(search.query)));

      // Newest first, so everything published since the cutoff is at the top.
      const { jobs } = await queryJobs({ ...filters, sort: 'newest', page: 1 }, publicClient);

      const fresh = jobs
        .filter((job) => job.published_at && job.published_at > since)
        .slice(0, MAX_JOBS);

      if (fresh.length === 0) {
        empty += 1;
        continue;
      }

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

        Allowed to fail quietly: a read that fails now skips the week rather
        than falling back to Arabic — recipient() re-reads this row inside the
        send and returns null when it cannot, so it already meant no mail.
      */
      const { data: profile } = await admin
        .from('profiles')
        .select('role, locale')
        .eq('id', search.candidate_id)
        .maybeSingle();

      if (profile?.role !== 'candidate') {
        notForCandidates += 1;
        continue;
      }

      const locale = profile.locale === 'en' ? 'en' : 'ar';

      const outcome = await sendSavedSearchDigest({
        userId: search.candidate_id,
        searchId: search.id,
        label: search.label,
        query: search.query,
        jobs: fresh.map((job) => ({
          title: localized(locale, job.title_ar, job.title_en),
          company: localized(locale, job.company?.name_ar, job.company?.name_en),
          slug: job.slug,
        })),
      });

      if (outcome === 'sent') {
        sent += 1;
        // Only on a real send. A skip because the recipient turned digests off
        // must not silently consume the window they would have covered.
        await admin
          .from('saved_searches')
          .update({ last_sent_at: new Date().toISOString() })
          .eq('id', search.id);
      }
    } catch (cause) {
      // One bad saved search must not stop the run for everyone else.
      console.warn(
        `[job-alerts] search ${search.id} failed:`,
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  return NextResponse.json({
    considered: searches?.length ?? 0,
    sent,
    nothing_new: empty,
    not_candidates: notForCandidates,
    at: new Date().toISOString(),
  });
}
