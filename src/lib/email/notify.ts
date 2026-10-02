import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentVisibility, ApplicationStatus } from '@/lib/supabase/database.types';
import { env } from '@/lib/env';
import { trustedLogoUrl } from '@/lib/avatar-url';
import { localized } from '@/i18n/routing';
import { displayJobStatus, jobIsLive } from '@/lib/job-state';
import { copyFor, localeOf } from './copy';
import { followedCompany } from '@/lib/saved-search';
import { buildEnvelope, type Audience } from './envelope';
import { deliver } from './service';
import type { SendOutcome } from './send';
import { unsubscribeLinks } from './unsubscribe-link';
import { stageTelling, tellingSuffix } from '@/lib/application-arrival';

/**
 * One function per product event.
 *
 * Every one of them is called for its side effect, returns rather than throws,
 * and is safe to call twice — the dedupe key decides whether a second call
 * sends anything. Email is never the point of the action that triggered it: an
 * application must be recorded whether or not the employer hears about it.
 *
 * These read across RLS boundaries on purpose. A candidate cannot see the
 * employer's email address and must not be able to; the service role does the
 * lookup, and the authorisation was already decided by the action that got
 * here.
 *
 * Nothing in this file writes HTML. It chooses blocks and hands over strings,
 * so every job title and candidate name goes through the escaping in
 * components.ts rather than through whichever template remembered.
 */

/**
 * The three switches, plus the absence of one.
 *
 * `null` means transactional: a receipt, a security notice, the answer to a
 * question somebody asked by signing up. Those carry no unsubscribe link and
 * check no preference, because suppressing them would leave a person waiting
 * forever on something that already happened. Everything else is a stream that
 * keeps arriving, and turning a stream off is a reasonable thing to want.
 */
type Preference = 'notify_applications' | 'notify_status' | 'notify_digest' | 'notify_profile_nudge' | null;

type Recipient = {
  userId: string;
  email: string;
  locale: 'ar' | 'en';
  unsubscribeToken: string;
  /** Who they are on the platform, for a notice that reads differently by role. */
  role: string | null;
};

/**
 * A read that failed, as opposed to one that found nothing.
 *
 * supabase-js answers a timeout, a 503 or a dropped connection with
 * `{ data: null, error }` rather than a throw, and these composers used to
 * read only `data` — so an outage looked exactly like "no such application"
 * or "this person opted out", and came back as 'skipped'. For a first send
 * that is a message silently not sent; under the retry sweeper it was worse,
 * because 'skipped' there means "nothing left to say" and cancels the row for
 * good. Thrown instead, the composer's own catch returns 'failed' and the row
 * is retried like any other failure.
 *
 * Only the code travels in the message: it is what that catch logs.
 */
function readFailed(what: string, error: { code?: string; status?: number } | null): never {
  throw new Error(`${what} read failed (${error?.code ?? error?.status ?? 'unknown'})`);
}

/**
 * The recipient's address and language, or null if they should not be written
 * to — preference off, no profile, or no email on the account. A read that
 * errors throws (readFailed) rather than answering null.
 */
async function recipient(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preference: Preference,
): Promise<Recipient | null> {
  // The whole row rather than a list of switches: a database that has not had
  // the newest switch's migration yet answers without it, where naming it
  // would fail every email's read.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) readFailed('profile', profileError);
  if (!profile) return null;
  if (preference) {
    const value = (profile as Record<string, unknown>)[preference];
    // The profile reminder is opt-in (migration 337): only a yes sends it, and
    // a database without the switch has not asked anybody. Every other switch
    // is on until turned off.
    if (preference === 'notify_profile_nudge' ? value !== true : value === false) return null;
  }

  // The token lives on profile_private (migration 305), where no company that
  // reads an applicant's profile can reach it. Service role, as before.
  const { data: secret, error: secretError } = await admin
    .from('profile_private')
    .select('unsubscribe_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (secretError) readFailed('unsubscribe token', secretError);
  if (!secret) return null;

  // The address lives on auth.users, not profiles. A 404 is a real "no such
  // account"; anything else is the Auth API failing to answer.
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error && error.status !== 404) readFailed('account', error);
  if (error || !data.user?.email) return null;

  return {
    userId,
    email: data.user.email,
    locale: localeOf(profile.locale),
    unsubscribeToken: secret.unsubscribe_token,
    role: typeof profile.role === 'string' ? profile.role : null,
  };
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shapes for the embedded selects below.
 *
 * The generated PostgREST types resolve a single embed but not a nested one,
 * so these are declared and cast, the same way every other two-level select in
 * this codebase is.
 */
type JobBits = {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string | null;
  expires_at: string | null;
  published_at: string | null;
  version: number;
};

type ApplicationForEmployer = {
  id: string;
  created_at: string;
  experience_band: string | null;
  candidate_id: string;
  job: (JobBits & { company: { id: string } | null }) | null;
};

type ApplicationForCandidate = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  decision_note: string | null;
  candidate_id: string;
  job:
    | (JobBits & { company: { name_ar: string; name_en: string | null; slug: string } | null })
    | null;
};

type JobForOwner = JobBits & {
  company: { id: string; owner_id: string; name_ar: string } | null;
  /** The moderator's reason, read again when a refusal is retried. */
  rejection_note?: string | null;
};

// `version` is here for the dedupe keys below: it moves on every update, so a
// listing that enters the moderation queue a second time is a second event
// rather than a key that has already been claimed.
const JOB_FIELDS = 'id, slug, title_ar, title_en, expires_at, published_at, version';

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/**
 * Somebody finished onboarding.
 *
 * Deliberately split by role rather than sent as one neutral greeting: the
 * next useful thing to do is completely different for the two audiences, and a
 * welcome whose button goes to the wrong half of the product is worse than no
 * welcome.
 */
export async function notifyWelcome(userId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) readFailed('profile', profileError);
    if (!profile) return 'skipped';
    if (profile.role === 'admin') return 'skipped';

    const to = await recipient(admin, userId, null);
    if (!to) return 'skipped';

    const employer = profile.role === 'employer';
    const c = copyFor(to.locale);
    const t = employer ? c.welcomeEmployer : c.welcomeCandidate;

    return deliver({
      template: employer ? 'welcome_employer' : 'welcome_candidate',
      to: to.email,
      userId,
      dedupeKey: `welcome:${userId}`,
      entity: { type: 'profile', id: userId },
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject,
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body },
          {
            kind: 'button',
            label: t.cta,
            href: employer
              ? `${env.siteUrl}/employer/company`
              : `${env.siteUrl}/dashboard/profile`,
          },
          { kind: 'text', value: t.hint },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] welcome failed:', asMessage(error));
    return 'failed';
  }
}

/**
 * Somebody's password changed.
 *
 * The only message here triggered by the browser rather than by the server
 * that performed the thing — Supabase's updateUser runs client-side, so no
 * server action sees it happen. That makes it the one place an email could be
 * asked for by a caller that is merely signed in, so the request is checked
 * against evidence rather than taken on trust: auth.users.updated_at has to
 * have moved within the last few minutes, which only a real credential change
 * does.
 *
 * Transactional and unconditional. A security notice somebody has switched off
 * is a security notice that does not exist, and the entire value of this one is
 * telling a person about a change they did not make.
 */
export async function notifyPasswordChanged(userId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();

    const { data: account, error } = await admin.auth.admin.getUserById(userId);
    if (error || !account.user?.email) return 'skipped';

    // The evidence. Without it this is a button that mails anybody who is
    // signed in, as often as they press it.
    const changedAt = account.user.updated_at ? new Date(account.user.updated_at) : null;
    if (!changedAt || Date.now() - changedAt.getTime() > 5 * 60_000) return 'skipped';

    const to = await recipient(admin, userId, null);
    if (!to) return 'skipped';

    const t = copyFor(to.locale).passwordChanged;

    return deliver({
      template: 'password_changed',
      to: to.email,
      userId,
      // Keyed to the change itself, so pressing save twice is one email and a
      // genuine second change tomorrow is a second one.
      dedupeKey: `password_changed:${userId}:${changedAt.toISOString()}`,
      entity: { type: 'profile', id: userId },
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject,
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body },
          { kind: 'facts', rows: [[t.labelWhen, formatMoment(changedAt, to.locale)]] },
          {
            kind: 'button',
            label: t.cta,
            href: `${env.siteUrl}/dashboard/account`,
            variant: 'secondary',
          },
          { kind: 'security', value: t.security },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] password notice failed:', asMessage(error));
    return 'failed';
  }
}

/**
 * A candidate signed up and never finished.
 *
 * Once ever, which the copy promises and the dedupe key is what actually
 * guarantees — the cron's query will keep returning the same person every
 * morning until they either finish or age out of its window, and nothing in
 * that query knows whether they have already been told.
 */
export async function notifyProfileIncomplete(userId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    // Its own switch, off unless turned on (migration 337): this is a nudge,
    // not an answer to anything the person asked for, and it is the closest
    // thing here to marketing. It used to ride on notify_digest, which is on
    // by default and says "weekly job roundup".
    const to = await recipient(admin, userId, 'notify_profile_nudge');
    if (!to) return 'skipped';

    const t = copyFor(to.locale).profileIncomplete;

    return deliver({
      template: 'profile_incomplete',
      to: to.email,
      userId,
      dedupeKey: `profile_incomplete:${userId}`,
      entity: { type: 'profile', id: userId },
      envelope: buildEnvelope({
        // Its own link turns off the reminder, not the job roundup.
        audience: audienceOf(to, 'notify_profile_nudge'),
        subject: t.subject,
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/profile` },
          { kind: 'text', value: t.hint },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] profile reminder failed:', asMessage(error));
    return 'failed';
  }
}

/**
 * A candidate's directory profile now exists.
 *
 * Distinct from the welcome, which arrives at onboarding when there is nothing
 * to look at yet. This is the one that can say what the profile's visibility
 * actually is, because by now they have chosen it.
 */
export async function notifyProfileReady(
  userId: string,
  slug: string,
  visibility: AgentVisibility,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const to = await recipient(admin, userId, null);
    if (!to) return 'skipped';

    const c = copyFor(to.locale);
    const t = c.profileReady;

    return deliver({
      template: 'profile_ready',
      to: to.email,
      userId,
      dedupeKey: `profile_ready:${userId}`,
      entity: { type: 'profile', id: userId },
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject,
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body },
          {
            kind: 'facts',
            rows: [[t.labelVisibility, c.visibilityChanged.visibility[visibility]]],
          },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/agents/${slug}` },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] profile ready notice failed:', asMessage(error));
    return 'failed';
  }
}

/** A candidate changed who can see them in the directory. */
export async function notifyVisibilityChanged(
  userId: string,
  visibility: AgentVisibility,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const to = await recipient(admin, userId, null);
    if (!to) return 'skipped';

    const c = copyFor(to.locale);
    const t = c.visibilityChanged;

    /*
      Keyed on the change itself: the database dates each choice the owner
      makes (visibility_chosen_at, migration 336), so the same change
      published twice sends one message and every change sends its own.
      Keyed on the value and the day, a third change in one day back to a
      setting already told — perhaps by somebody else holding the session —
      was silent; keyed on the value alone, it was once per setting, ever.
      The bell keeps its key per day: it is a record, and a feed full of
      toggles helps nobody. This is the security notice. Not retried, so the
      stamp read now is the one the change made.
    */
    const { data: card, error: cardError } = await admin
      .from('agent_profiles')
      .select('visibility_chosen_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (cardError) readFailed('directory profile', cardError);
    const chosenAt = card?.visibility_chosen_at ? Date.parse(card.visibility_chosen_at) : NaN;
    const change = Number.isFinite(chosenAt) ? String(chosenAt) : cairoDay(new Date());

    return deliver({
      template: 'visibility_changed',
      to: to.email,
      userId,
      dedupeKey: `visibility:${userId}:${visibility}:${change}`,
      entity: { type: 'profile', id: userId },
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject,
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body },
          { kind: 'facts', rows: [[t.labelVisibility, t.visibility[visibility]]] },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/account` },
          { kind: 'security', value: t.security },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] visibility notice failed:', asMessage(error));
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/**
 * Employer: somebody applied.
 *
 * Everyone at the company, not whoever signed up. Migration 51 moved the
 * in-app bell onto membership for the same reason: the recruiter whose listing
 * it is, and who will actually answer the applicant, was the one person not
 * being told. Each member decides for themselves — `notify_applications` and
 * the digest switch are per-account and read per member, so widening the
 * recipients widens nothing anybody has turned off.
 */
export async function notifyEmployerOfApplication(applicationId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();

    const { data, error: applicationError } = await admin
      .from('applications')
      .select(
        `id, created_at, experience_band, candidate_id, job:jobs (${JOB_FIELDS}, company:companies (id))`,
      )
      .eq('id', applicationId)
      .maybeSingle();
    if (applicationError) readFailed('application', applicationError);

    const application = data as unknown as ApplicationForEmployer | null;
    const job = application?.job;
    const companyId = job?.company?.id;
    if (!application || !job || !companyId) return 'skipped';

    const { data: members, error: membersError } = await admin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId);
    if (membersError) readFailed('members', membersError);

    const audience = (members ?? []).map((row) => row.user_id);
    if (!audience.length) return 'skipped';

    const { data: candidate } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', application.candidate_id)
      .maybeSingle();

    const name = candidate?.full_name ?? '';
    let outcome: SendOutcome = 'skipped';
    let anyFailed = false;

    for (const memberId of audience) {
      // One person's preferences are not the company's: a member who has
      // turned this off is skipped, and the next member's copy is unaffected.
      // Nor is one person's failure: a read that fails for this member is
      // theirs, and the rest still hear about the applicant.
      let sent: SendOutcome;
      try {
        sent = await oneApplicationNotice({
          admin,
          memberId,
          job,
          applicationId,
          candidateId: application.candidate_id,
          name,
        });
      } catch (error) {
        console.warn('[email] employer application notice failed for a member:', asMessage(error));
        sent = 'failed';
      }
      if (sent === 'sent') outcome = 'sent';
      if (sent === 'failed') anyFailed = true;
    }

    // Any member's failure makes the whole call 'failed', even if another
    // member's copy went. The retry sweeper reads this: a rebuild for one
    // member's row that "sent" to a colleague must not look like a message
    // with nothing left to say, or that member's row is cancelled unsent.
    return anyFailed ? 'failed' : outcome;
  } catch (error) {
    console.warn('[email] employer application notice failed:', asMessage(error));
    return 'failed';
  }
}

/** One member's copy of it. */
async function oneApplicationNotice({
  admin,
  memberId,
  job,
  applicationId,
  candidateId,
  name,
}: {
  admin: ReturnType<typeof createAdminClient>;
  memberId: string;
  job: JobBits;
  applicationId: string;
  candidateId: string;
  name: string;
}): Promise<SendOutcome> {
  const to = await recipient(admin, memberId, 'notify_applications');
  if (!to) return 'skipped';

  // The digest is a delivery mode, not a second subscription: with it on, this
  // notice stands down and the daily summary carries the same event. Checked
  // here rather than at the cron, so there is one place that decides and no
  // window in which both go out.
  const { data: mode, error: modeError } = await admin
    .from('profiles')
    .select('notify_applicant_digest')
    .eq('id', memberId)
    .maybeSingle();
  // Unknown is not "off": sending the single notice to someone who chose the
  // digest would tell them twice.
  if (modeError) readFailed('delivery mode', modeError);
  if (mode?.notify_applicant_digest) return 'skipped';

  const t = copyFor(to.locale).newApplication;
  const title = localized(to.locale, job.title_ar, job.title_en);

  // Name and role only. The CV, the phone number and the record sit behind the
  // button, where the employer is authenticated — an email is forwarded,
  // quoted and left in inboxes, and none of that is a place to put a
  // candidate's contact details.
  return deliver({
    template: 'new_application',
    to: to.email,
    userId: memberId,
    /*
      The listing, the person, and the recipient.

      Withdrawing deletes the application and reapplying makes a new one with a
      new id, so a key on the id let one candidate mail an employer about the
      same listing as many times as they cared to apply and withdraw. The
      employer's interest is "this person applied to this listing", which
      happens once however many rows carry it — and once per member, since each
      of them is a separate message to a separate inbox.
    */
    dedupeKey: `new_application:${job.id}:${candidateId}:${memberId}`,
    entity: { type: 'application', id: applicationId },
    envelope: buildEnvelope({
      audience: audienceOf(to, 'notify_applications'),
      subject: t.subject(title),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(name, title) },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, title],
            [t.labelApplicant, name],
          ],
        },
        {
          kind: 'button',
          label: t.cta,
          href: `${env.siteUrl}/employer/jobs/${job.id}/applicants`,
        },
      ],
    }),
  });
}

/**
 * Candidate: their application landed.
 *
 * Transactional, and the one message here that most obviously is: it is a
 * receipt for something the person just did. It carries no unsubscribe and
 * checks no preference for the same reason a shop receipt does not.
 */
export async function notifyCandidateOfApplication(applicationId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const application = await candidateApplication(admin, applicationId);
    const job = application?.job;
    if (!application || !job) return 'skipped';

    const to = await recipient(admin, application.candidate_id, null);
    if (!to) return 'skipped';

    const c = copyFor(to.locale);
    const t = c.applicationReceived;
    const title = localized(to.locale, job.title_ar, job.title_en);
    const company = job.company
      ? localized(to.locale, job.company.name_ar, job.company.name_en)
      : '';

    return deliver({
      template: 'application_receipt',
      to: to.email,
      userId: application.candidate_id,
      dedupeKey: `application_receipt:${applicationId}`,
      entity: { type: 'application', id: applicationId },
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(title, company) },
          {
            kind: 'job',
            title,
            company,
            href: `${env.siteUrl}/jobs/${job.slug}`,
          },
          {
            kind: 'facts',
            rows: [
              [t.labelDate, formatDay(application.created_at, to.locale)],
              // The application's own id, which is what support will ask for.
              [t.labelRef, applicationId.slice(0, 8)],
            ],
          },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/applications` },
          { kind: 'text', value: t.note },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] application receipt failed:', asMessage(error));
    return 'failed';
  }
}

/**
 * Candidate: the employer moved them along, or didn't.
 *
 * `rejected` gets its own template rather than the generic status card. The
 * generic one reads as an administrative update, which is the wrong register
 * for the message somebody least wants to receive — and it has a different job
 * to do, which is to point at the rest of the board.
 */
export async function notifyCandidateOfStatus(applicationId: string): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const application = await candidateApplication(admin, applicationId);
    const job = application?.job;
    if (!application || !job) return 'skipped';

    // "new" is the state an application is created in, not a decision anyone
    // made about it. Mailing on it would mean a message every time an employer
    // opened the pipeline.
    if (application.status === 'new') return 'skipped';

    const to = await recipient(admin, application.candidate_id, 'notify_status');
    if (!to) return 'skipped';

    const c = copyFor(to.locale);
    const title = localized(to.locale, job.title_ar, job.title_en);
    const company = job.company
      ? localized(to.locale, job.company.name_ar, job.company.name_en)
      : '';
    const audience = audienceOf(to, 'notify_status');

    /*
      Keyed on the status, and on which telling of it this is
      (application-arrival.ts): shortlisted → interview → hired sends three
      messages; an employer saving the same stage twice, or tidying a card
      back to "new" and out again, sends one; rejected, reconsidered, then
      rejected again sends the second rejection, which a key on the stage
      alone held back forever. The move is recorded (application_events)
      before this runs. A history that cannot be read is a failure, not a
      first telling: counted as one, a retry of the second rejection found the
      first's key taken and was cancelled for good (readFailed).
    */
    const { data: history, error: historyError } = await admin
      .from('application_events')
      .select('to_status')
      .eq('application_id', applicationId)
      .order('id', { ascending: true });
    if (historyError) readFailed('application history', historyError);
    const telling = stageTelling((history ?? []).map((event) => event.to_status), application.status);
    const dedupeKey = `status:${applicationId}:${application.status}${tellingSuffix(telling)}`;
    const entity = { type: 'application', id: applicationId } as const;

    if (application.status === 'rejected') {
      const t = c.applicationRejected;
      return deliver({
        template: 'application_rejected',
        to: to.email,
        userId: application.candidate_id,
        dedupeKey,
        entity,
        envelope: buildEnvelope({
          audience,
          subject: t.subject(title),
          preheader: t.preheader,
          heading: t.heading,
          blocks: [
            { kind: 'text', value: t.body(title, company) },
            ...(application.decision_note
              ? [{ kind: 'text' as const, value: application.decision_note }]
              : []),
            { kind: 'divider' },
            { kind: 'text', value: t.encouragement },
            { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs` },
          ],
        }),
      });
    }

    const t = c.statusChanged;
    return deliver({
      template: 'application_status',
      to: to.email,
      userId: application.candidate_id,
      dedupeKey,
      entity,
      envelope: buildEnvelope({
        audience,
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(title, company) },
          { kind: 'status', label: c.status[application.status], tone: toneFor(application.status) },
          {
            kind: 'facts',
            rows: [
              [t.labelJob, title],
              [t.labelCompany, company],
            ],
          },
          ...(application.decision_note
            ? [{ kind: 'text' as const, value: application.decision_note }]
            : []),
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/applications` },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] candidate status notice failed:', asMessage(error));
    return 'failed';
  }
}

/**
 * Candidate: they withdrew.
 *
 * Takes the details rather than the id, because withdrawing deletes the row —
 * by the time this runs there is nothing left to read.
 */
export async function notifyApplicationWithdrawn(args: {
  userId: string;
  applicationId: string;
  jobTitleAr: string;
  jobTitleEn: string | null;
}): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const to = await recipient(admin, args.userId, null);
    if (!to) return 'skipped';

    const t = copyFor(to.locale).applicationWithdrawn;
    const title = localized(to.locale, args.jobTitleAr, args.jobTitleEn);

    return deliver({
      template: 'application_withdrawn',
      to: to.email,
      userId: args.userId,
      dedupeKey: `withdrawn:${args.applicationId}`,
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(title) },
          { kind: 'facts', rows: [[t.labelJob, title]] },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs` },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] withdrawal notice failed:', asMessage(error));
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

/**
 * Employer: their listing entered the review queue.
 *
 * To whoever submitted it, which on a company with recruiters is not
 * necessarily the owner — the receipt is for the person who pressed the
 * button. Falls back to the owner when the submitter is unknown (an old outbox
 * row) or is no longer a member of the company.
 */
export async function notifyJobSubmitted(
  jobId: string,
  submittedBy?: string | null,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const job = await ownedJob(admin, jobId);
    const companyId = job?.company?.id;
    if (!job || !companyId) return 'skipped';

    let recipientId = job.company?.owner_id ?? null;
    if (submittedBy) {
      const { data: member } = await admin
        .from('company_members')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('user_id', submittedBy)
        .maybeSingle();
      if (member) recipientId = submittedBy;
    }
    if (!recipientId) return 'skipped';
    const ownerId = recipientId;

    const to = await recipient(admin, ownerId, null);
    if (!to) return 'skipped';

    const t = copyFor(to.locale).jobSubmitted;
    const title = localized(to.locale, job.title_ar, job.title_en);

    return deliver({
      template: 'job_submitted',
      to: to.email,
      userId: ownerId,
      /*
        Keyed on the version, not the listing.

        `job_submitted:${jobId}` meant a listing announced itself to the
        moderation queue exactly once, ever. A rejected listing resubmitted
        after being fixed is a second, genuine queue entry — and since a
        material edit to a live listing now sends it back for review too, so is
        every one of those. Both were silently deduplicated against the first
        submission, which could be weeks old.
      */
      dedupeKey: `job_submitted:${jobId}:${job.version}`,
      entity: { type: 'job', id: jobId },
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(title) },
          {
            kind: 'facts',
            rows: [
              [t.labelJob, title],
              [t.labelDate, formatDay(new Date().toISOString(), to.locale)],
              [t.labelStatus, t.statusPending],
            ],
          },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs` },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] job submitted notice failed:', asMessage(error));
    return 'failed';
  }
}

/**
 * Employer: moderation decided on a listing.
 *
 * Every member of the company, each under their own preference — the same
 * audience the bell has had since migration 51. Addressed to owner_id alone,
 * the recruiter who wrote the listing heard about it only if they happened to
 * look at the bell, and a company whose owner had left heard nothing.
 */
export async function notifyEmployerOfModeration(
  jobId: string,
  approved: boolean,
  note?: string | null,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const job = await ownedJob(admin, jobId);
    const companyId = job?.company?.id;
    if (!job || !companyId) return 'skipped';

    // A retry (rebuild.ts) passes no note: the reason is the listing's own,
    // or the retried refusal said "rejected, edit and resend" and not why.
    const reason = note !== undefined ? note : approved ? null : (job.rejection_note ?? null);
    return forEachMember(admin, companyId, (memberId) =>
      oneModerationNotice({ admin, memberId, job, approved, note: reason }),
    );
  } catch (error) {
    console.warn('[email] moderation notice failed:', asMessage(error));
    return 'failed';
  }
}

async function oneModerationNotice({
  admin,
  memberId,
  job,
  approved,
  note,
}: {
  admin: ReturnType<typeof createAdminClient>;
  memberId: string;
  job: JobForOwner;
  approved: boolean;
  note?: string | null;
}): Promise<SendOutcome> {
  const to = await recipient(admin, memberId, 'notify_status');
  if (!to) return 'skipped';

  const c = copyFor(to.locale);
  const title = localized(to.locale, job.title_ar, job.title_en);
  const audience = audienceOf(to, 'notify_status');
  const jobId = job.id;

  if (approved) {
    const t = c.jobApproved;
    return deliver({
      template: 'job_approved',
      to: to.email,
      userId: memberId,
      dedupeKey: `job_approved:${jobId}:${job.version}:${memberId}`,
      entity: { type: 'job', id: jobId },
      envelope: buildEnvelope({
        audience,
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(title) },
          {
            kind: 'facts',
            rows: [
              [t.labelJob, title],
              ...(job.published_at
                ? ([[t.labelPublished, formatDay(job.published_at, to.locale)]] as [
                    string,
                    string,
                  ][])
                : []),
              ...(job.expires_at
                ? ([[t.labelExpires, formatDay(job.expires_at, to.locale)]] as [string, string][])
                : []),
            ],
          },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs/${job.slug}` },
        ],
      }),
    });
  }

  const t = c.jobRejected;
  return deliver({
    template: 'job_rejected',
    to: to.email,
    userId: memberId,
    dedupeKey: `job_rejected:${jobId}:${job.version}:${memberId}`,
    entity: { type: 'job', id: jobId },
    envelope: buildEnvelope({
      audience,
      subject: t.subject(title),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(title) },
        ...(note ? [{ kind: 'text' as const, value: t.reason(note) }] : []),
        { kind: 'facts', rows: [[t.labelJob, title]] },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs/${job.id}/edit` },
      ],
    }),
  });
}

/** How far ahead the expiring warning looks. expire-jobs uses the same. */
export const EXPIRY_WARN_DAYS = 3;

/**
 * The prefix every member's copy of one expiry notice shares — the key is
 * `<prefix><memberId>`. expire-jobs matches on it to pass over listings whose
 * notice already has outbox rows before spending its nightly budget on them.
 * `expiresAt` is the string PostgREST returns for the column, which is what
 * both callers have in hand.
 */
export function jobExpiryKeyPrefix(
  stage: 'expiring' | 'expired',
  jobId: string,
  expiresAt: string | null,
): string {
  return `${stage === 'expiring' ? 'job_expiring' : 'job_expired'}:${jobId}:${expiresAt ?? ''}:`;
}

/**
 * An expiry notice, re-derived for the retry sweeper.
 *
 * notifyJobExpiry takes the applicant count from its caller, so it had no
 * rebuilder — and a row with no rebuilder is dead-lettered on sight, keeping
 * its key. That key then made every later catch-up run's claim come back
 * empty: a notice that failed once on a provider 503 was never sent at all,
 * and requeueing it only dead-lettered it again. This recounts, and first
 * checks the notice is still true — a warning about a listing that has since
 * expired or been renewed past the warning band, or an "it has expired" about
 * one that is live again, would be worse than none. A count that cannot be
 * read fails the rebuild (an attempt spent, retried) rather than sending
 * "nobody applied" to an employer who had forty applicants.
 */
export async function rebuildJobExpiry(
  jobId: string,
  stage: 'expiring' | 'expired',
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const { data: job, error } = await admin
      .from('jobs')
      .select('status, expires_at')
      .eq('id', jobId)
      .maybeSingle();
    if (error) readFailed('listing', error);
    if (!job?.expires_at) return 'skipped';

    // By the date, not the label (job-state.ts): a listing the relabel has
    // not reached yet is expired all the same.
    const stillTrue =
      stage === 'expiring'
        ? jobIsLive(job) && Date.parse(job.expires_at) <= Date.now() + EXPIRY_WARN_DAYS * 86_400_000
        : displayJobStatus(job) === 'expired';
    if (!stillTrue) return 'skipped';

    const { count, error: countError } = await admin
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId);
    if (countError || count === null) readFailed('applicant count', countError);

    return notifyJobExpiry(jobId, stage, count);
  } catch (error) {
    console.warn('[email] expiry notice rebuild failed:', asMessage(error));
    return 'failed';
  }
}

/** Employer: a listing is near the end of its run, or past it. Every member. */
export async function notifyJobExpiry(
  jobId: string,
  stage: 'expiring' | 'expired',
  applicantCount: number,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const job = await ownedJob(admin, jobId);
    const companyId = job?.company?.id;
    if (!job || !companyId) return 'skipped';

    return forEachMember(admin, companyId, (memberId) =>
      oneExpiryNotice({ admin, memberId, job, stage, applicantCount }),
    );
  } catch (error) {
    console.warn('[email] expiry notice failed:', asMessage(error));
    return 'failed';
  }
}

async function oneExpiryNotice({
  admin,
  memberId,
  job,
  stage,
  applicantCount,
}: {
  admin: ReturnType<typeof createAdminClient>;
  memberId: string;
  job: JobForOwner;
  stage: 'expiring' | 'expired';
  applicantCount: number;
}): Promise<SendOutcome> {
  const to = await recipient(admin, memberId, 'notify_status');
  if (!to) return 'skipped';

  const c = copyFor(to.locale);
  const title = localized(to.locale, job.title_ar, job.title_en);
  const audience = audienceOf(to, 'notify_status');
  const count = String(applicantCount);
  const jobId = job.id;

  if (stage === 'expiring') {
    const t = c.jobExpiring;
    const days = daysUntil(job.expires_at);
    return deliver({
      template: 'job_expiring',
      to: to.email,
      userId: memberId,
      // One warning per listing per run, per member. A listing that is renewed
      // and expires again is a different expires_at and so a different key.
      dedupeKey: `job_expiring:${jobId}:${job.expires_at ?? ''}:${memberId}`,
      entity: { type: 'job', id: jobId },
      envelope: buildEnvelope({
        audience,
        subject: t.subject(title),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(title, days) },
          {
            kind: 'facts',
            rows: [
              [t.labelJob, title],
              ...(job.expires_at
                ? ([[t.labelExpires, formatDay(job.expires_at, to.locale)]] as [string, string][])
                : []),
              [t.labelApplicants, count],
            ],
          },
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs` },
        ],
      }),
    });
  }

  const t = c.jobExpired;
  return deliver({
    template: 'job_expired',
    to: to.email,
    userId: memberId,
    dedupeKey: `job_expired:${jobId}:${job.expires_at ?? ''}:${memberId}`,
    entity: { type: 'job', id: jobId },
    envelope: buildEnvelope({
      audience,
      subject: t.subject(title),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(title) },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, title],
            ...(job.expires_at
              ? ([[t.labelExpired, formatDay(job.expires_at, to.locale)]] as [string, string][])
              : []),
            [t.labelApplicants, count],
          ],
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs` },
      ],
    }),
  });
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

/**
 * An account is told what the account review decided.
 *
 * A candidate is held or suspended, and restored, too — and was sent the
 * employer's words: "we reviewed your company details", and a button to post
 * a role, which bounced them. The wording, and where the button goes, follow
 * the account's role.
 *
 * Transactional, and one of the clearest cases: it is the answer to a question
 * the person asked by signing up, and it arrives once. Suppressing it would
 * leave somebody waiting forever on a decision that was already made, with an
 * account that looks broken and no way to find out why. It is also the only
 * notice that reliably reaches them — an employer waiting to be approved is,
 * by definition, not sitting in the console watching a bell.
 */
export async function notifyAccountDecision(
  userId: string,
  approved: boolean,
  note?: string | null,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();
    const to = await recipient(admin, userId, null);
    if (!to) return 'skipped';

    const c = copyFor(to.locale);
    const candidate = to.role === 'candidate';
    const t = approved
      ? candidate
        ? c.accountApprovedCandidate
        : c.accountApproved
      : candidate
        ? c.accountRejectedCandidate
        : c.accountRejected;

    return deliver({
      template: approved ? 'account_approved' : 'account_rejected',
      to: to.email,
      userId,
      // Not keyed on the decision alone: an account suspended, restored and
      // suspended again must say so each time. The timestamp is the run.
      dedupeKey: `account:${userId}:${approved}:${new Date().toISOString().slice(0, 13)}`,
      entity: { type: 'profile', id: userId },
      envelope: buildEnvelope({
        audience: audienceOf(to, null),
        subject: t.subject,
        preheader: t.preheader,
        heading: t.heading,
        blocks: approved
          ? [
              { kind: 'text', value: t.body },
              candidate
                ? { kind: 'button', label: c.accountApprovedCandidate.cta, href: `${env.siteUrl}/dashboard` }
                : { kind: 'button', label: c.accountApproved.cta, href: `${env.siteUrl}/employer/jobs/new` },
            ]
          : [
              { kind: 'text', value: t.body },
              ...(note ? [{ kind: 'text' as const, value: c.accountRejected.reason(note) }] : []),
              { kind: 'security', value: c.accountRejected.contact },
            ],
      }),
    });
  } catch (error) {
    console.warn('[email] account decision notice failed:', asMessage(error));
    return 'failed';
  }
}

/** Employer: the document review finished, one way or the other. Every member. */
export async function notifyCompanyVerification(
  companyId: string,
  verified: boolean,
  note?: string | null,
): Promise<SendOutcome> {
  try {
    const admin = createAdminClient();

    const { data: company, error: companyError } = await admin
      .from('companies')
      .select('id, slug, name_ar, name_en, owner_id, logo_url, version')
      .eq('id', companyId)
      .maybeSingle();
    if (companyError) readFailed('company', companyError);
    if (!company) return 'skipped';

    /*
      The decision this message is about, as the console recorded it
      (admin_review_company writes it to admin_audit_log): its id keys a
      refusal, and its reason is the one quoted — a retry (rebuild.ts) passes
      no note. Read from the company's state instead, a retry after the
      company had moved on (papers sent again, the row's version bumped) was a
      new key, sent again to members who already had it, and it quoted the
      newest refused paper — a previous round's note when this refusal had no
      papers to write its own on.
    */
    const { data: decision, error: decisionError } = await admin
      .from('admin_audit_log')
      .select('id, reason')
      .eq('target_type', 'company')
      .eq('target_id', companyId)
      .in('action', verified ? ['company.verify'] : ['company.reject', 'company.request_changes'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (decisionError) readFailed('company decision', decisionError);
    const reason = note !== undefined ? note : (decision?.reason ?? null);
    // A refusal per decision (each can carry its own reason); a verification
    // once ever, as the bell's is — a badge that flaps is not news twice.
    const round = decision ? `d${decision.id}` : `v${company.version}`;

    return forEachMember(admin, companyId, async (memberId) => {
      const to = await recipient(admin, memberId, null);
      if (!to) return 'skipped';

      const c = copyFor(to.locale);
      const t = verified ? c.companyVerified : c.companyVerificationNeeded;
      const name = localized(to.locale, company.name_ar, company.name_en);

      return deliver({
        template: verified ? 'company_verified' : 'company_verification_needed',
        to: to.email,
        userId: memberId,
        // A refusal per decision: keyed on the outcome alone, a second refusal
        // — new papers, refused again — was never sent, the first one's key
        // still held.
        dedupeKey: verified
          ? `company_verification:${companyId}:true:${memberId}`
          : `company_verification:${companyId}:false:${round}:${memberId}`,
        entity: { type: 'company', id: companyId },
        envelope: buildEnvelope({
          audience: audienceOf(to, null),
          subject: t.subject,
          preheader: t.preheader,
          heading: t.heading,
          blocks: [
            { kind: 'text', value: t.body(name) },
            {
              kind: 'company',
              name,
              logoUrl: trustedLogoUrl(company.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL),
              href: `${env.siteUrl}/companies/${company.slug}`,
            },
            ...(!verified && reason
              ? [{ kind: 'text' as const, value: c.companyVerificationNeeded.reason(reason) }]
              : []),
            {
              kind: 'button',
              label: t.cta,
              href: verified
                ? `${env.siteUrl}/companies/${company.slug}`
                : `${env.siteUrl}/employer/company`,
            },
          ],
        }),
      });
    });
  } catch (error) {
    console.warn('[email] company verification notice failed:', asMessage(error));
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Optional
// ---------------------------------------------------------------------------

/**
 * The weekly roundup for one saved search.
 *
 * Takes the matching jobs rather than finding them, so the alert job owns the
 * "what is new since last time" question and this owns only the message. It
 * still checks the recipient's preference, because a digest is the one message
 * here closest to marketing and the least excusable to get wrong.
 */
export async function sendSavedSearchDigest(args: {
  userId: string;
  searchId: string;
  label: string;
  query: string;
  jobs: { title: string; company: string; slug: string; meta?: string[] }[];
}): Promise<SendOutcome> {
  if (args.jobs.length === 0) return 'skipped';

  try {
    const admin = createAdminClient();
    const to = await recipient(admin, args.userId, 'notify_digest');
    if (!to) return 'skipped';

    /*
      A follow and a saved search are one row and one weekly job — that is the
      point of building a follow that way — but they cannot share the words.
      Somebody who pressed Follow on a company and is then told "there is
      something new in your search" goes looking for a saved search they never
      made, and the next thing they do is try to turn it off.

      Decided from the stored query rather than from an argument, so the caller
      cannot pass the wrong one and the cron needs no new knowledge.
    */
    const copy = copyFor(to.locale);
    const isFollow = followedCompany(args.query) !== null;
    const t = isFollow ? copy.follow : copy.digest;

    return deliver({
      /*
        Two names for one job, because the outbox is a delivery log and a row
        reading `saved_search_digest` for a message headed "new from a company
        you follow" is the same small lie the heading used to tell. The dedupe
        key is built on the search id and the week, not on this, so nothing
        about once-a-week changes.
      */
      template: isFollow ? 'company_follow_digest' : 'saved_search_digest',
      to: to.email,
      userId: args.userId,
      // One per search per week. The week number is the run, so a cron that
      // fires twice on the same Monday sends one message.
      dedupeKey: `digest:${args.searchId}:${isoWeek()}`,
      entity: { type: 'saved_search', id: args.searchId },
      envelope: buildEnvelope({
        audience: audienceOf(to, 'notify_digest'),
        subject: t.subject(args.jobs.length, args.label),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(args.label) },
          ...args.jobs.slice(0, 6).map(
            (job) =>
              ({
                kind: 'job',
                title: job.title,
                company: job.company,
                meta: job.meta,
                href: `${env.siteUrl}/jobs/${job.slug}`,
              }) as const,
          ),
          {
            kind: 'button',
            label: t.cta,
            href: `${env.siteUrl}/jobs${args.query ? `?${args.query}` : ''}`,
          },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] saved-search digest failed:', asMessage(error));
    return 'failed';
  }
}

/**
 * Employer: one message a day instead of one per applicant.
 *
 * The individual notice is the default because it is what a small company
 * wants. This exists for the listing that gets twenty applications in an
 * afternoon, where twenty emails is not twenty times as useful — it is one
 * useful email and nineteen reasons to switch notifications off entirely.
 */
export async function sendApplicantDigest(args: {
  userId: string;
  count: number;
  jobs: { title: string; company: string; slug: string; meta?: string[] }[];
}): Promise<SendOutcome> {
  if (args.count === 0) return 'skipped';

  try {
    const admin = createAdminClient();
    const to = await recipient(admin, args.userId, 'notify_applications');
    if (!to) return 'skipped';

    const t = copyFor(to.locale).applicantDigest;

    return deliver({
      template: 'applicant_digest',
      to: to.email,
      userId: args.userId,
      dedupeKey: `applicant_digest:${args.userId}:${new Date().toISOString().slice(0, 10)}`,
      envelope: buildEnvelope({
        audience: audienceOf(to, 'notify_applications'),
        subject: t.subject(args.count),
        preheader: t.preheader,
        heading: t.heading,
        blocks: [
          { kind: 'text', value: t.body(args.count) },
          ...args.jobs.slice(0, 6).map(
            (job) =>
              ({
                kind: 'job',
                title: job.title,
                company: job.company,
                meta: job.meta,
                href: `${env.siteUrl}/employer/jobs`,
              }) as const,
          ),
          { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/applicants` },
        ],
      }),
    });
  } catch (error) {
    console.warn('[email] applicant digest failed:', asMessage(error));
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Everyone at a company, one message each.
 *
 * The in-app bell has addressed company_members since migration 51; email
 * addressed owner_id, so the two channels disagreed about who "the employer"
 * is. This is the one place email answers that question now. Sequential, so a
 * company of ten does not fire ten requests at a rate-limited provider at once,
 * and each member's preference is read for that member alone.
 *
 * 'sent' if anybody was sent one, 'failed' if nobody was and somebody's
 * failed, otherwise 'skipped' — the same fold notifyEmployerOfApplication uses.
 */
async function forEachMember(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  send: (memberId: string) => Promise<SendOutcome>,
): Promise<SendOutcome> {
  const { data: members, error: membersError } = await admin
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId);
  if (membersError) readFailed('members', membersError);

  let outcome: SendOutcome = 'skipped';
  let anyFailed = false;
  for (const { user_id } of members ?? []) {
    let result: SendOutcome;
    try {
      result = await send(user_id);
    } catch (error) {
      // One member's failure is not the next member's.
      console.warn('[email] member notice failed:', asMessage(error));
      result = 'failed';
    }
    if (result === 'sent') outcome = 'sent';
    if (result === 'failed') anyFailed = true;
  }
  // Any failure wins, as in notifyEmployerOfApplication: the retry sweeper
  // must not read a colleague's 'sent' as "nothing left to say" for the
  // member whose copy failed.
  return anyFailed ? 'failed' : outcome;
}

function audienceOf(to: Recipient, preference: Preference): Audience {
  return {
    locale: to.locale,
    // Transactional mail carries no unsubscribe: there is nothing to
    // unsubscribe from, and offering one that would be ignored is worse than
    // offering none.
    unsubscribe: preference ? unsubscribeLinks(env.siteUrl, to.unsubscribeToken, preference) : undefined,
  };
}

async function candidateApplication(
  admin: ReturnType<typeof createAdminClient>,
  applicationId: string,
) {
  const { data, error } = await admin
    .from('applications')
    .select(
      `id, status, created_at, decision_note, candidate_id, job:jobs (${JOB_FIELDS}, company:companies (name_ar, name_en, slug))`,
    )
    .eq('id', applicationId)
    .maybeSingle();
  if (error) readFailed('application', error);
  return data as unknown as ApplicationForCandidate | null;
}

async function ownedJob(admin: ReturnType<typeof createAdminClient>, jobId: string) {
  const { data, error } = await admin
    .from('jobs')
    .select(`${JOB_FIELDS}, rejection_note, company:companies (id, owner_id, name_ar)`)
    .eq('id', jobId)
    .maybeSingle();
  if (error) readFailed('listing', error);
  return data as unknown as JobForOwner | null;
}

function toneFor(status: ApplicationStatus) {
  switch (status) {
    case 'hired':
      return 'positive' as const;
    case 'rejected':
      return 'closed' as const;
    case 'interview':
      return 'caution' as const;
    case 'shortlisted':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
}

/**
 * Western digits in both languages, matching the convention the interface
 * already follows — and `en-GB` under the hood for Arabic, because
 * `ar-EG` renders Arabic-Indic numerals.
 */
function formatDay(value: string, locale: 'ar' | 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  }).format(date);
}

/** Date and time, in Cairo — a security notice without a clock is unusable. */
function formatMoment(date: Date, locale: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Cairo',
  }).format(date);
}

/** The calendar day in Cairo, YYYY-MM-DD — what a once-a-day key counts in. */
function cairoDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function daysUntil(value: string | null): number {
  if (!value) return 0;
  const diff = new Date(value).getTime() - Date.now();
  return Math.max(1, Math.ceil(diff / 86_400_000));
}

/** Year and week, so a digest is keyed to the run rather than the day. */
function isoWeek(): string {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const week = Math.floor((now.getTime() - start) / (7 * 86_400_000));
  return `${now.getUTCFullYear()}w${week}`;
}
