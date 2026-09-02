import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { env } from '@/lib/env';
import { localized } from '@/i18n/routing';
import { copyFor, localeOf } from './copy';
import { renderEmail, renderText, type Button } from './layout';
import { sendEmail, type SendOutcome } from './send';

/**
 * Notifications, all of them best-effort.
 *
 * Every function here is called for its side effect and returns rather than
 * throws. Email is never the point of the action that triggered it: an
 * application must be recorded whether or not the employer hears about it, and
 * none of this can work until SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY are
 * set — which, today, they are not anywhere.
 *
 * These read across RLS boundaries on purpose. A candidate cannot see the
 * employer's email address and must not be able to; the service role does the
 * lookup, and the authorisation was already decided by the action that got
 * here.
 */

type Prefs = 'notify_applications' | 'notify_status' | 'notify_digest';

/**
 * Shapes for the embedded selects below.
 *
 * The generated PostgREST types resolve a single embed but not a nested one,
 * so these are declared and cast, the same way every other two-level select in
 * this codebase is.
 */
type ApplicationForEmployer = {
  id: string;
  candidate_id: string;
  job: {
    id: string;
    slug: string;
    title_ar: string;
    title_en: string | null;
    company: { owner_id: string } | null;
  } | null;
};

type ApplicationForCandidate = {
  id: string;
  status: ApplicationStatus;
  candidate_id: string;
  job: {
    title_ar: string;
    title_en: string | null;
    company: { name_ar: string; name_en: string | null } | null;
  } | null;
};

type JobForModeration = {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string | null;
  company: { owner_id: string } | null;
};

type Recipient = {
  email: string;
  locale: 'ar' | 'en';
  unsubscribeToken: string;
};

/**
 * The recipient's address and language, or null if they should not be written
 * to — preference off, no profile, or no email on the account.
 */
async function recipient(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preference: Prefs,
): Promise<Recipient | null> {
  const { data: profile } = await admin
    .from('profiles')
    .select(`locale, unsubscribe_token, ${preference}`)
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return null;
  if ((profile as Record<string, unknown>)[preference] === false) return null;

  // The address lives on auth.users, not profiles.
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return null;

  return {
    email: data.user.email,
    locale: localeOf(profile.locale),
    unsubscribeToken: profile.unsubscribe_token,
  };
}

function compose(args: {
  to: Recipient;
  preference: Prefs;
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  facts?: [string, string][];
  button?: Button;
}) {
  const t = copyFor(args.to.locale);
  const unsubscribeUrl = `${env.siteUrl}/unsubscribe?token=${args.to.unsubscribeToken}&kind=${args.preference}`;
  const unsubscribe = { label: t.unsubscribe, href: unsubscribeUrl };

  const shared = {
    heading: args.heading,
    paragraphs: args.paragraphs,
    facts: args.facts,
    button: args.button,
    footerNote: t.footerNote,
    unsubscribe,
  };

  return {
    to: args.to.email,
    subject: args.subject,
    html: renderEmail({
      locale: args.to.locale,
      siteName: t.siteName,
      preheader: args.preheader,
      ...shared,
    }),
    text: renderText(shared),
    unsubscribeUrl,
  };
}

/** Employer: somebody applied. */
export async function notifyEmployerOfApplication(applicationId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();

    const { data } = await admin
      .from('applications')
      .select(
        'id, candidate_id, job:jobs (id, slug, title_ar, title_en, company:companies (owner_id))',
      )
      .eq('id', applicationId)
      .maybeSingle();

    const application = data as unknown as ApplicationForEmployer | null;
    const job = application?.job;
    const ownerId = job?.company?.owner_id;
    if (!job || !ownerId) return 'skipped';

    const to = await recipient(admin, ownerId, 'notify_applications');
    if (!to) return 'skipped';

    const { data: candidate } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', application.candidate_id)
      .maybeSingle();

    const t = copyFor(to.locale).newApplication;
    const title = localized(to.locale, job.title_ar, job.title_en);
    const name = candidate?.full_name ?? '';

    return sendEmail(
      compose({
        to,
        preference: 'notify_applications',
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        paragraphs: [t.body(name, title)],
        facts: [
          [t.labelJob, title],
          [t.labelApplicant, name],
        ],
        button: {
          label: t.cta,
          href: `${env.siteUrl}/employer/jobs/${job.id}/applicants`,
        },
      }),
    );
  } catch (error) {
    console.warn('[email] employer application notice failed:', asMessage(error));
    return 'failed';
  }
}

/** Candidate: the employer moved them along, or didn't. */
export async function notifyCandidateOfStatus(applicationId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();

    const { data } = await admin
      .from('applications')
      .select(
        'id, status, candidate_id, job:jobs (title_ar, title_en, company:companies (name_ar, name_en))',
      )
      .eq('id', applicationId)
      .maybeSingle();

    const application = data as unknown as ApplicationForCandidate | null;
    const job = application?.job;
    if (!application || !job) return 'skipped';

    // "new" is the state an application is created in, not a decision anyone
    // made about it. Mailing on it would mean a message every time an employer
    // opened the pipeline.
    if (application.status === 'new') return 'skipped';

    const to = await recipient(admin, application.candidate_id, 'notify_status');
    if (!to) return 'skipped';

    const t = copyFor(to.locale).statusChanged;
    const statusLabels = copyFor(to.locale).status;
    const title = localized(to.locale, job.title_ar, job.title_en);
    const company = localized(to.locale, job.company?.name_ar, job.company?.name_en);

    return sendEmail(
      compose({
        to,
        preference: 'notify_status',
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        paragraphs: [t.body(title, company)],
        facts: [
          [t.labelJob, title],
          [t.labelCompany, company],
          [t.labelStatus, statusLabels[application.status]],
        ],
        button: { label: t.cta, href: `${env.siteUrl}/dashboard/applications` },
      }),
    );
  } catch (error) {
    console.warn('[email] candidate status notice failed:', asMessage(error));
    return 'failed';
  }
}

/** Employer: moderation decided on a listing. */
export async function notifyEmployerOfModeration(
  jobId: string,
  approved: boolean,
  note?: string | null,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();

    const { data } = await admin
      .from('jobs')
      .select('id, slug, title_ar, title_en, company:companies (owner_id)')
      .eq('id', jobId)
      .maybeSingle();

    const job = data as unknown as JobForModeration | null;
    const ownerId = job?.company?.owner_id;
    if (!job || !ownerId) return 'skipped';

    const to = await recipient(admin, ownerId, 'notify_status');
    if (!to) return 'skipped';

    const c = copyFor(to.locale);
    const t = approved ? c.jobApproved : c.jobRejected;
    const title = localized(to.locale, job.title_ar, job.title_en);

    const paragraphs = [t.body(title)];
    if (!approved && note) paragraphs.push(c.jobRejected.reason(note));

    return sendEmail(
      compose({
        to,
        preference: 'notify_status',
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        paragraphs,
        facts: [[t.labelJob, title]],
        button: {
          label: t.cta,
          href: approved
            ? `${env.siteUrl}/jobs/${job.slug}`
            : `${env.siteUrl}/employer/jobs/${job.id}/edit`,
        },
      }),
    );
  } catch (error) {
    console.warn('[email] moderation notice failed:', asMessage(error));
    return 'failed';
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


/**
 * The weekly roundup for one saved search.
 *
 * Takes the matching jobs rather than finding them, so the alert job owns the
 * "what is new since last time" question and this owns only the message. It
 * still checks the recipient's preference, because a digest is the one message
 * here that is closest to marketing and the least excusable to get wrong.
 */
export async function sendSavedSearchDigest(args: {
  userId: string;
  label: string;
  query: string;
  jobs: { title: string; company: string }[];
}): Promise<SendOutcome> {
  if (args.jobs.length === 0) return 'skipped';

  try {
    const admin = createAdminClient();
    const to = await recipient(admin, args.userId, 'notify_digest');
    if (!to) return 'skipped';

    const t = copyFor(to.locale).digest;

    return sendEmail(
      compose({
        to,
        preference: 'notify_digest',
        subject: t.subject(args.jobs.length, args.label),
        preheader: t.preheader,
        heading: t.heading,
        paragraphs: [t.body(args.label)],
        // One row per role: the title, and who is hiring for it.
        facts: args.jobs.map((job) => [job.title, job.company] as [string, string]),
        button: {
          label: t.cta,
          href: `${env.siteUrl}/jobs${args.query ? `?${args.query}` : ''}`,
        },
      }),
    );
  } catch (error) {
    console.warn('[email] saved-search digest failed:', asMessage(error));
    return 'failed';
  }
}
