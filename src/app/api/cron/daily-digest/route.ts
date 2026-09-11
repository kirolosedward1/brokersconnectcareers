import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
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
 * Morning in Cairo rather than the small hours: a digest that arrives at 1am
 * is at the bottom of the inbox by the time anyone is working.
 */

export async function GET(request: NextRequest) {
  const secret = env.cronSecret;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  // --- employers who asked for one email instead of many -------------------
  const { data: owed, error } = await admin.rpc('pending_applicant_digests', {
    p_since: '24 hours',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let digests = 0;
  for (const row of owed ?? []) {
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

    if (outcome === 'sent') digests += 1;
  }

  // --- candidates who signed up and stopped --------------------------------
  /*
    Allowed to fail quietly — but not silently, because this one is the whole
    second half of the job. A failure means nobody is reminded and the route
    still answers `{ reminders: 0 }`, which looks exactly like a day when
    nobody needed reminding. The digests above have already been sent, so
    failing the request now would make a retry send them twice.
  */
  const { data: unfinished, error: unfinishedError } = await admin.rpc(
    'incomplete_candidate_profiles',
    { p_limit: 50 },
  );
  if (unfinishedError) {
    logFailure('cron', 'could not list incomplete profiles', { code: unfinishedError.code });
  }

  let reminders = 0;
  for (const row of unfinished ?? []) {
    if ((await notifyProfileIncomplete(row.user_id)) === 'sent') reminders += 1;
  }

  return NextResponse.json({ digests, reminders, at: new Date().toISOString() });
}
