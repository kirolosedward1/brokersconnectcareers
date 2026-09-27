import type { NextRequest } from 'next/server';
import { runScheduledJob } from '@/lib/jobs/run';
import { retryDb } from '@/lib/jobs/db';
import { localized } from '@/i18n/routing';
import { notifyProfileIncomplete, sendApplicantDigest } from '@/lib/email/notify';
import { logFailure } from '@/lib/observe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The two daily batches.
 *
 * Both exist to replace something worse. The applicant digest replaces twenty
 * individual notices to an employer who took twenty applications in an
 * afternoon — which is one useful email and nineteen reasons to turn
 * notifications off. The profile reminder replaces the silence that a
 * candidate who signed up and never finished currently sits in, invisible to
 * every employer on the platform and with no way of knowing it.
 *
 * Neither can repeat. The employer digest is keyed to the calendar day; the
 * profile reminder is keyed to the person, once ever, which is what the copy
 * promises them.
 *
 * Neither loses anybody to a missed run either. pending_applicant_digests()
 * counts from each employer's last digest actually sent (capped at a week),
 * not from a fixed 24 hours ago, so a morning the cron did not fire is folded
 * into the next morning's email instead of vanishing. And from when that
 * digest's list was taken — the start of the run that sent it — rather than
 * the moment it went, so someone who applies while this loop is still working
 * through the list is in tomorrow's count instead of in neither.
 *
 * Bounded by the run's time budget, and one bad row never stops the rest: a
 * profile that will not load or a listing lookup that fails is counted in
 * `errors` and the loop moves on. Whatever is left when time runs out is
 * still owed tomorrow and is picked up then.
 *
 * Morning in Cairo rather than the small hours: a digest that arrives at 1am
 * is at the bottom of the inbox by the time anyone is working.
 */

export async function GET(request: NextRequest) {
  return runScheduledJob(request, {
    job: 'daily-digest',
    maxDurationSeconds: maxDuration,
    work: async ({ admin, deadline }) => {
      const stats = { digests: 0, reminders: 0, errors: 0, out_of_time: false };

      // --- employers who asked for one email instead of many -----------------
      // A failure to list them fails the run, as it always did: nothing has
      // been sent yet, so there is nothing a retry could send twice.
      const owed =
        (await retryDb(() => admin.rpc('pending_applicant_digests', { p_since: '24 hours' }))) ?? [];

      for (const row of owed) {
        if (deadline.expired()) {
          stats.out_of_time = true;
          break;
        }

        try {
          // Allowed to fail quietly: the fallback below is Arabic, which is this
          // market's default and what most of these accounts read anyway. A digest
          // in the wrong language beats no digest.
          const { data: profile } = await admin
            .from('profiles')
            .select('locale')
            .eq('id', row.user_id)
            .maybeSingle();
          const locale = profile?.locale === 'en' ? 'en' : 'ar';

          // The listings the applicants came to, so the email says which roles are
          // moving rather than only how many people applied.
          // Allowed to fail quietly: these are the listing names inside the email.
          // Losing them sends "7 new applicants" without naming the roles, which is
          // still true and still gets somebody to the inbox.
          const { data: jobs } = await admin
            .from('jobs')
            .select('slug, title_ar, title_en, company:companies (name_ar, name_en)')
            .in('id', row.job_ids.slice(0, 6));

          const outcome = await sendApplicantDigest({
            userId: row.user_id,
            count: Number(row.applicant_count),
            jobs: (jobs ?? []).map((job) => {
              const company = job.company as unknown as {
                name_ar: string;
                name_en: string | null;
              } | null;
              return {
                title: localized(locale, job.title_ar, job.title_en),
                company: company ? localized(locale, company.name_ar, company.name_en) : '',
                slug: job.slug,
              };
            }),
          });

          if (outcome === 'sent') stats.digests += 1;
        } catch {
          stats.errors += 1;
          logFailure('cron', 'applicant digest failed', { user: row.user_id });
        }
      }

      // --- candidates who signed up and stopped --------------------------------
      /*
        Allowed to fail quietly — but not silently, because this one is the whole
        second half of the job. A failure means nobody is reminded, so it is
        counted in `errors` and logged rather than answering `{ reminders: 0 }`,
        which looks exactly like a day when nobody needed reminding. The run is
        not failed for it: the digests above have already gone, and a failed run
        reads as "nothing happened".
      */
      if (!deadline.expired()) {
        const { data: unfinished, error: unfinishedError } = await admin.rpc(
          'incomplete_candidate_profiles',
          { p_limit: 50 },
        );
        if (unfinishedError) {
          stats.errors += 1;
          logFailure('cron', 'could not list incomplete profiles', { code: unfinishedError.code });
        }

        for (const row of unfinished ?? []) {
          if (deadline.expired()) {
            stats.out_of_time = true;
            break;
          }
          try {
            if ((await notifyProfileIncomplete(row.user_id)) === 'sent') stats.reminders += 1;
          } catch {
            stats.errors += 1;
            logFailure('cron', 'profile reminder failed', { user: row.user_id });
          }
        }
      } else {
        stats.out_of_time = true;
      }

      return stats;
    },
  });
}
