import type { ApplicationStatus } from '@/lib/supabase/database.types';

/**
 * An application's stages, in the order a pipeline shows them, and what each
 * means to the two people it concerns — written once for the website's
 * dashboard, inbox, pipeline and console and for the app, which draw the
 * same list and the same badges. It was copied into each of those, and a
 * stage added to the database (or a colour changed) would have reached some
 * and not others.
 *
 * No imports but a type, so the app may bundle it (mobile/scripts/check-shared.mjs).
 */
export const APPLICATION_STAGES = ['new', 'shortlisted', 'interview', 'hired', 'rejected'] as const satisfies readonly ApplicationStatus[];

/** The badge each stage wears: open, moving, decided for, decided against. */
export const STAGE_TONE: Record<ApplicationStatus, 'default' | 'primary' | 'success' | 'destructive'> = {
  new: 'default',
  shortlisted: 'primary',
  interview: 'primary',
  hired: 'success',
  rejected: 'destructive',
};

/**
 * Whether the candidate may still withdraw: only while the outcome is open,
 * which is the database's rule too (migration 42).
 */
export function canWithdraw(status: ApplicationStatus): boolean {
  return status === 'new' || status === 'shortlisted';
}

export type StepState = 'done' | 'current' | 'ahead' | 'stopped';
export type TimelineStep = { key: 'sent' | 'seen' | 'shortlisted' | 'decision'; state: StepState; date: string | null };

/**
 * Where an application stands, as four steps: sent, seen by the company,
 * shortlisted (or called to an interview), and the decision. A step is done
 * once the application has passed it — a status past "new" means somebody at
 * the company opened it, whether or not the opening was recorded — and a
 * rejection ends the line where it happened, marked as such rather than as a
 * step skipped. Drawn by the website's applications page and the app's alike.
 */
export function timelineSteps(application: {
  status: ApplicationStatus;
  created_at: string;
  employer_viewed_at: string | null;
}): TimelineStep[] {
  const { status } = application;
  const seen = status !== 'new' || Boolean(application.employer_viewed_at);
  const shortlisted = status === 'shortlisted' || status === 'interview' || status === 'hired';
  const decided = status === 'hired' || status === 'rejected';
  return [
    { key: 'sent', state: 'done', date: application.created_at },
    { key: 'seen', state: seen ? 'done' : 'current', date: application.employer_viewed_at },
    {
      key: 'shortlisted',
      state: shortlisted ? 'done' : status === 'rejected' ? 'ahead' : seen ? 'current' : 'ahead',
      date: null,
    },
    { key: 'decision', state: status === 'rejected' ? 'stopped' : decided ? 'done' : shortlisted ? 'current' : 'ahead', date: null },
  ];
}
