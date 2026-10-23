import type { ApplicationStatus } from '@/lib/supabase/database.types';

/**
 * The application pipeline, as both the website and the app draw it.
 *
 * The order, the badge each stage wears and when a candidate may withdraw
 * were written out by hand on every page and screen that showed them, and on
 * the server schema that accepts a move — ten copies nothing held together.
 * A stage added to the database type now fails to compile here until it has
 * a place in the order and a tone.
 *
 * Pure on purpose: the app bundles this (scripts/check-shared.mjs).
 */

/**
 * The stages an employer moves, and the ones the pipeline counts.
 * Withdrawing is the candidate's; it is not a column on the board.
 */
export const PIPELINE_STAGES = ['new', 'shortlisted', 'interview', 'hired', 'rejected'] as const satisfies readonly ApplicationStatus[];

/** Every status, pipeline first and withdrawn last — the order a list is drawn. */
export const APPLICATION_STAGES = [...PIPELINE_STAGES, 'withdrawn'] as const satisfies readonly ApplicationStatus[];

/**
 * The broker badge for a withdrawn application: 12px, weight 500, #5B6475 on
 * #F2F4F7, 6px radius. The pair is 5.3:1. The card uses the same text colour
 * and does not fade.
 */
export const WITHDRAWN_BADGE = {
  color: '#5B6475',
  background: '#F2F4F7',
  radius: 6,
  fontSize: 12,
  fontWeight: 500,
} as const;

/** Same grey, light enough to read on a dark card. */
export const WITHDRAWN_TEXT_DARK = '#C5CAD3';

// A status the list leaves out is a compile error rather than a missing column.
type Missing = Exclude<ApplicationStatus, (typeof APPLICATION_STAGES)[number]>;
const everyStage: [Missing] extends [never] ? true : Missing = true;
void everyStage;

export type StageTone = 'default' | 'primary' | 'success' | 'destructive';

/** The badge each stage wears. */
export const STAGE_TONE: Record<ApplicationStatus, StageTone> = {
  new: 'default',
  shortlisted: 'primary',
  interview: 'primary',
  hired: 'success',
  rejected: 'destructive',
  withdrawn: 'default',
};

/**
 * Withdrawing is offered only while the outcome is still open. The database's
 * withdrawal precondition (migration 42) is what enforces it; this decides
 * whether the button is drawn.
 */
export function canWithdraw(status: ApplicationStatus): boolean {
  return status === 'new' || status === 'shortlisted';
}

/** Standing applications keep their order; withdrawn ones follow them. */
export function withWithdrawnLast<T extends { status: string }>(rows: readonly T[]): T[] {
  const standing: T[] = [];
  const withdrawn: T[] = [];
  for (const row of rows) {
    if (row.status === 'withdrawn') withdrawn.push(row);
    else standing.push(row);
  }
  return standing.concat(withdrawn);
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
  if (status === 'withdrawn') {
    const seen = Boolean(application.employer_viewed_at);
    return [
      { key: 'sent', state: 'done', date: application.created_at },
      { key: 'seen', state: seen ? 'done' : 'ahead', date: application.employer_viewed_at },
      { key: 'shortlisted', state: 'ahead', date: null },
      { key: 'decision', state: 'stopped', date: null },
    ];
  }
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
