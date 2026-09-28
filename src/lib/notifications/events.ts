import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentVisibility } from '@/lib/supabase/database.types';
import {
  notifyAccountDecision,
  notifyApplicationWithdrawn,
  notifyCandidateOfApplication,
  notifyCandidateOfStatus,
  notifyCompanyVerification,
  notifyEmployerOfApplication,
  notifyEmployerOfModeration,
  notifyJobExpiry,
  notifyJobSubmitted,
  notifyPasswordChanged,
  notifyProfileReady,
  notifyVisibilityChanged,
  notifyWelcome,
} from '@/lib/email/notify';
import { flushPushes } from '@/lib/push/deliver';
import { dispatch, type DispatchReport, type Route } from './dispatch';

/**
 * The notification service.
 *
 *   BUSINESS EVENT  →  publish()  →  in-app  →  email  →  delivery log
 *                                       └→  phone (a push per in-app row, migration 329)
 *
 * An action says *what happened*; this decides who hears about it and through
 * which channels. No page or action calls an email function directly any more
 * — they publish an event, so the list of consequences of "an application was
 * created" lives in one table below rather than in whichever action remembered.
 *
 * In-app, and where it is written
 * -------------------------------
 * Almost every in-app notification is written by a database trigger on the
 * row that changed (migrations 17, 51, 52, 301, 302). That is deliberate and it is
 * the stronger half of this design: the bell is written in the same
 * transaction as the fact it reports, so it cannot be skipped by a code path
 * that forgot to publish, and it cannot claim something that rolled back. Each
 * trigger catches its own failure, so a broken notification never takes the
 * application or the listing down with it.
 *
 * Two events have no row to hang a trigger on, and are written from here:
 *
 *   SECURITY_EVENT   the password change happens in the browser, against
 *                    auth.users; the server only hears about it afterwards.
 *   JOB_EXPIRING/    a date passing changes no row. The sweep that writes
 *   JOB_EXPIRED      these runs from the cron and from the employer console.
 *
 * Email, and the log
 * ------------------
 * Each email handler claims a row in the email_log outbox under a
 * deterministic dedupe key before sending, so a retried request, a
 * double-submitted form, a re-run cron and the retry sweeper all collapse into
 * one message; `sent` and `delivered` are recorded as separate facts. The
 * in-app row and the outbox row share the key vocabulary (see migration 301's
 * header), so "once" means the same thing in both.
 *
 * Failure
 * -------
 * publish() never throws and is called from after(), once the response has
 * gone. An email that fails leaves its in-app notification exactly where it
 * was — they are separate writes — and leaves an outbox row the sweeper
 * retries. Channels are isolated from one another: one failing does not stop
 * the next.
 */

export type BusinessEvent =
  /** A candidate applied. Also NEW_APPLICANT, from the company's side. */
  | { type: 'APPLICATION_CREATED'; applicationId: string }
  | { type: 'APPLICATION_STATUS_CHANGED'; applicationId: string }
  /** Taken as data: withdrawing deletes the row this would otherwise read. */
  | {
      type: 'APPLICATION_WITHDRAWN';
      candidateId: string;
      applicationId: string;
      jobTitleAr: string;
      jobTitleEn: string | null;
    }
  | { type: 'JOB_SUBMITTED'; jobId: string; submittedBy: string }
  | { type: 'JOB_APPROVED'; jobId: string }
  | { type: 'JOB_REJECTED'; jobId: string; note?: string | null }
  | { type: 'JOB_EXPIRING'; jobId: string; applicantCount: number }
  | { type: 'JOB_EXPIRED'; jobId: string; applicantCount: number }
  | { type: 'COMPANY_VERIFIED'; companyId: string }
  | { type: 'COMPANY_VERIFICATION_REJECTED'; companyId: string; note?: string | null }
  | { type: 'ACCOUNT_APPROVED'; userId: string }
  | { type: 'ACCOUNT_SUSPENDED'; userId: string; note?: string | null }
  | { type: 'ACCOUNT_ONBOARDED'; userId: string }
  | { type: 'PROFILE_CREATED'; userId: string; slug: string; visibility: AgentVisibility }
  | { type: 'PROFILE_VISIBILITY_CHANGED'; userId: string; visibility: AgentVisibility }
  | { type: 'SECURITY_EVENT'; userId: string; kind: 'password_changed' };

export type EventType = BusinessEvent['type'];
type Of<T extends EventType> = Extract<BusinessEvent, { type: T }>;

/**
 * Where each event's in-app notification comes from.
 *
 * 'trigger:<name>' and 'sweep:<name>' are documentation — the database writes
 * it (a row trigger, or the idempotent expiry sweep), and there is nothing for
 * this module to do. 'none' is a decision, not an omission: the event is the
 * reader's own action with an on-screen confirmation, or an email-only message
 * by nature (a welcome). A function is written here.
 */
type Routes = { [T in EventType]: Route<Of<T>> };

export const ROUTES: Routes = {
  APPLICATION_CREATED: {
    inApp: 'trigger:on_application_created',
    email: [
      (e) => notifyEmployerOfApplication(e.applicationId),
      (e) => notifyCandidateOfApplication(e.applicationId),
    ],
  },
  APPLICATION_STATUS_CHANGED: {
    inApp: 'trigger:on_application_moved',
    email: [(e) => notifyCandidateOfStatus(e.applicationId)],
  },
  APPLICATION_WITHDRAWN: {
    // The company hears via on_application_withdrawn when the applicant was
    // shortlisted; the candidate did this themselves and saw it happen.
    inApp: 'trigger:on_application_withdrawn',
    email: [
      (e) =>
        notifyApplicationWithdrawn({
          userId: e.candidateId,
          applicationId: e.applicationId,
          jobTitleAr: e.jobTitleAr,
          jobTitleEn: e.jobTitleEn,
        }),
    ],
  },
  JOB_SUBMITTED: {
    // A receipt for the submitter's own action, shown on screen as they do it.
    inApp: 'none',
    email: [(e) => notifyJobSubmitted(e.jobId, e.submittedBy)],
  },
  JOB_APPROVED: {
    inApp: 'trigger:on_job_moderated',
    email: [(e) => notifyEmployerOfModeration(e.jobId, true)],
  },
  JOB_REJECTED: {
    inApp: 'trigger:on_job_moderated',
    email: [(e) => notifyEmployerOfModeration(e.jobId, false, e.note)],
  },
  JOB_EXPIRING: {
    inApp: 'sweep:emit_job_expiry_notifications',
    email: [(e) => notifyJobExpiry(e.jobId, 'expiring', e.applicantCount)],
  },
  JOB_EXPIRED: {
    inApp: 'sweep:emit_job_expiry_notifications',
    email: [(e) => notifyJobExpiry(e.jobId, 'expired', e.applicantCount)],
  },
  COMPANY_VERIFIED: {
    inApp: 'trigger:on_company_verified',
    email: [(e) => notifyCompanyVerification(e.companyId, true)],
  },
  COMPANY_VERIFICATION_REJECTED: {
    inApp: 'trigger:on_company_verified',
    email: [(e) => notifyCompanyVerification(e.companyId, false, e.note)],
  },
  ACCOUNT_APPROVED: {
    inApp: 'trigger:on_approval_changed',
    email: [(e) => notifyAccountDecision(e.userId, true)],
  },
  ACCOUNT_SUSPENDED: {
    inApp: 'trigger:on_approval_changed',
    email: [(e) => notifyAccountDecision(e.userId, false, e.note)],
  },
  ACCOUNT_ONBOARDED: {
    inApp: 'none',
    email: [(e) => notifyWelcome(e.userId)],
  },
  PROFILE_CREATED: {
    inApp: 'none',
    email: [(e) => notifyProfileReady(e.userId, e.slug, e.visibility)],
  },
  PROFILE_VISIBILITY_CHANGED: {
    inApp: 'trigger:on_agent_visibility_changed',
    email: [(e) => notifyVisibilityChanged(e.userId, e.visibility)],
  },
  SECURITY_EVENT: {
    inApp: recordPasswordChanged,
    email: [(e) => notifyPasswordChanged(e.userId)],
  },
};

export type PublishReport = DispatchReport & { type: EventType };

/**
 * Publish one business event. Never throws; call it from after().
 *
 * In-app first, then email, each channel caught on its own (dispatch.ts) — so
 * an email provider outage leaves the bell intact, and a bell failure still
 * sends the email.
 */
export async function publish(event: BusinessEvent): Promise<PublishReport> {
  const route = ROUTES[event.type] as Route<BusinessEvent>;
  const report = { type: event.type, ...(await dispatch(route, event)) };
  /*
    Phones. The bell's rows for this event were written with the fact, and a
    trigger queued a push for each one somebody has a phone for (migration
    329); this sends them now rather than at the next minute's sweep. Never
    throws, and gives up after a few seconds — the sweep has the rest.
  */
  await flushPushes();
  return report;
}

// ---------------------------------------------------------------------------
// In-app writers for the events no trigger can see
// ---------------------------------------------------------------------------

/**
 * The bell's half of a password change.
 *
 * Same evidence rule as the email: auth.users.updated_at must have moved in
 * the last few minutes, so a caller who is merely signed in cannot put a
 * "your password changed" notice in their own feed — or trigger one by
 * pressing a button — without having changed anything. The key is the change
 * itself, so the email and the bell agree on which change they are about.
 */
async function recordPasswordChanged(event: Of<'SECURITY_EVENT'>): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(event.userId);
  if (error || !data.user) return;

  const changedAt = data.user.updated_at ? new Date(data.user.updated_at) : null;
  if (!changedAt || Date.now() - changedAt.getTime() > 5 * 60_000) return;

  const { error: writeError } = await admin.rpc('notify', {
    p_user: event.userId,
    p_kind: 'password_changed',
    p_payload: { at: changedAt.toISOString() },
    p_href: '/dashboard/account',
    p_key: `password_changed:${event.userId}:${changedAt.toISOString()}`,
  });
  if (writeError) throw new Error(writeError.message);
}

