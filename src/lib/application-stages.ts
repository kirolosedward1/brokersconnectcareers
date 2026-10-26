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

/**
 * How many of these rows are still applicants. A withdrawal is a record, not
 * a person in the pipeline, so it is left out of every count.
 */
export function standingApplicantCount(rows: readonly { status: string }[]): number {
  return rows.reduce((total, row) => total + (row.status === 'withdrawn' ? 0 : 1), 0);
}

/** The database filter behind those counts. */
export function excludeWithdrawn<Q extends { neq: (column: string, value: string) => Q }>(query: Q): Q {
  return query.neq('status', 'withdrawn');
}

/**
 * The broker inbox's order, applied before `limit`.
 *
 * Standing rows have a null `withdrawn_at`, so nulls first keeps them ahead
 * of every withdrawal. Within the standing rows that key ties, and
 * `created_at` descending is what remains — newest first, which is why the
 * inbox exists. Doing this after the limit is too late: a page of recent
 * withdrawals would fill the cap and the older application still open would
 * never be fetched.
 */
export const INBOX_ORDER = [
  { column: 'withdrawn_at', ascending: true, nullsFirst: true },
  { column: 'created_at', ascending: false },
] as const;

type Ordered<Q> = {
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => Q;
};

export function orderInbox<Q extends Ordered<Q>>(query: Q): Q {
  return INBOX_ORDER.reduce((current, key) => {
    const options: { ascending: boolean; nullsFirst?: boolean } = { ascending: key.ascending };
    if ('nullsFirst' in key) options.nullsFirst = key.nullsFirst;
    return current.order(key.column, options);
  }, query);
}

/**
 * The same order as {@link INBOX_ORDER}, for a test that has no database.
 * Null `withdrawn_at` first, then that timestamp ascending, and `created_at`
 * descending wherever the first key ties.
 */
export function compareInboxRows(
  a: { created_at: string; withdrawn_at: string | null },
  b: { created_at: string; withdrawn_at: string | null },
): number {
  const aStanding = a.withdrawn_at == null;
  const bStanding = b.withdrawn_at == null;
  if (aStanding !== bStanding) return aStanding ? -1 : 1;
  if (!aStanding && a.withdrawn_at !== b.withdrawn_at) return a.withdrawn_at! < b.withdrawn_at! ? -1 : 1;
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? 1 : -1;
}

/** True when this database has no `withdrawn_at` column yet, so the inbox order cannot be asked for. */
export function withdrawnAtMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  if (!/withdrawn_at/i.test(message)) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /does not exist|schema cache/i.test(message);
}

/** True when `withdrawn` is not an `application_status` value yet, so a filter on it cannot be sent. */
export function withdrawnStatusMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '22P02' || /invalid input value for enum application_status/i.test(error.message ?? '');
}

export type StepState = 'done' | 'current' | 'ahead' | 'stopped';
export type TimelineStep = { key: 'sent' | 'seen' | 'shortlisted' | 'decision'; state: StepState; date: string | null };

/**
 * The candidate card's status, shared by the pill and the bar.
 *
 * Coarser than the employer's pipeline on purpose. Shortlisted and interview
 * are both still open, so both are «قيد المراجعة»; the line under the bar is
 * what says which of those it is. Hired is the accepted state. Rejected and
 * withdrawn are terminal and use their own words.
 */
export const PROGRESS_PILLS = ['new', 'review', 'hired', 'rejected', 'withdrawn'] as const;
export type ProgressPill = (typeof PROGRESS_PILLS)[number];

export type ProgressStepKey = 'sent' | 'seen' | 'shortlisted' | 'decision';

/** done = brand blue, current = white with a blue ring, upcoming/withdrawn = grey, rejected = red. */
export type SegmentTone = 'done' | 'current' | 'upcoming' | 'rejected' | 'withdrawn';

export type ProgressSegment = {
  key: ProgressStepKey;
  tone: SegmentTone;
  /**
   * When this step actually happened. Null when the step is not reached, or
   * when it is reached but nothing records the moment — never a guessed one.
   */
  date: string | null;
};

export type ProgressSummary = 'sent' | 'seen' | 'shortlisted' | 'hired' | 'rejected' | 'withdrawn';

export type ApplicationProgress = {
  pill: ProgressPill;
  segments: ProgressSegment[];
  summary: ProgressSummary;
  summaryDate: string | null;
};

/** One row of application_events: the transition and when it was written. */
export type ApplicationEventStamp = {
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  created_at: string;
};

const SHORTLIST_MOVE: readonly ApplicationStatus[] = ['shortlisted', 'interview'];

function earliestTo(events: readonly ApplicationEventStamp[], to: readonly ApplicationStatus[]): string | null {
  let best: string | null = null;
  for (const event of events) {
    // Insert and the migration-42 backfill write one event with a null
    // from_status at the row's then-current status. That is not a transition
    // and must not date a step. The step can still be done from the status.
    if (event.from_status == null) continue;
    if (!to.includes(event.to_status)) continue;
    if (best === null || event.created_at < best) best = event.created_at;
  }
  return best;
}

/** True when a shortlist or an interview is in the status or in the history. */
function reachedShortlist(status: ApplicationStatus, events: readonly ApplicationEventStamp[]): boolean {
  if (status === 'shortlisted' || status === 'interview' || status === 'hired') return true;
  return events.some(
    (event) =>
      SHORTLIST_MOVE.includes(event.to_status) ||
      (event.from_status !== null && SHORTLIST_MOVE.includes(event.from_status)),
  );
}

/**
 * True when the company has had the application, not merely when a column says so.
 *
 * `employer_viewed_at` is the only stamp of an opening. A move off `new` is
 * also an opening — somebody acted — except a withdrawal from `new`, which
 * the candidate can do before anyone looks. That case stays unseen unless the
 * history shows an employer move first.
 */
function companyOpened(
  status: ApplicationStatus,
  viewedAt: string | null,
  events: readonly ApplicationEventStamp[],
): boolean {
  if (viewedAt) return true;
  if (status === 'shortlisted' || status === 'interview' || status === 'hired' || status === 'rejected') return true;
  if (status === 'withdrawn') return reachedShortlist(status, events);
  return false;
}

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

/**
 * Where a candidate's application stands, for the pill and the bar together.
 *
 * Dates, and where they are not:
 *   sent        applications.created_at
 *   seen        applications.employer_viewed_at only. A view does not write
 *               application_events (the trigger ignores a change that is not
 *               a status move), so a reached "seen" with a null stamp has no
 *               date and none is invented from a later move.
 *   shortlist   the earliest application_events row whose to_status is
 *               shortlisted, or interview when they were interviewed without
 *               a shortlist row, ignoring events whose from_status is null.
 *               There is no shortlisted_at column.
 *   decision    the earliest event to hired or rejected, same filter. There
 *               is no hired_at, rejected_at, or decided_at column.
 *   withdrawn   applications.withdrawn_at, which the check constraint keeps
 *               in step with the status. A withdrawal event is the fallback,
 *               and a null from_status on that event is not a date.
 *
 * created_at dates only the sent step. A reached step with no real stamp
 * stays done and undated: the status line is the step text alone.
 *
 * A row inserted already at its current status (the demo seed, and the
 * backfill in migration 42) has one event with from_status null. That event
 * does not date the step it names, and it does not date the steps before it.
 *
 * Rejection drops steps that never happened instead of crossing them: the
 * bar stops at the decision, the last segment is the rejected one, and a
 * shortlist that was never reached is absent. Withdrawal draws only the
 * steps reached before it, in grey, and the line is the withdrawal.
 */
export function applicationProgress(application: {
  status: ApplicationStatus;
  created_at: string;
  employer_viewed_at: string | null;
  withdrawn_at?: string | null;
  events?: readonly ApplicationEventStamp[];
}): ApplicationProgress {
  const events = application.events ?? [];
  const { status } = application;
  const shortlistDate = earliestTo(events, ['shortlisted']) ?? earliestTo(events, ['interview']);
  const hiredDate = earliestTo(events, ['hired']);
  const rejectedDate = earliestTo(events, ['rejected']);
  const withdrawnDate = application.withdrawn_at ?? earliestTo(events, ['withdrawn']);
  const shortlist = reachedShortlist(status, events);
  const seen = companyOpened(status, application.employer_viewed_at, events) || shortlist;

  const pill: ProgressPill =
    status === 'withdrawn'
      ? 'withdrawn'
      : status === 'rejected'
        ? 'rejected'
        : status === 'hired'
          ? 'hired'
          : status === 'new' && !application.employer_viewed_at
            ? 'new'
            : 'review';

  if (status === 'withdrawn') {
    const segments: ProgressSegment[] = [
      { key: 'sent', tone: 'withdrawn', date: application.created_at },
    ];
    if (seen) segments.push({ key: 'seen', tone: 'withdrawn', date: application.employer_viewed_at });
    if (shortlist) segments.push({ key: 'shortlisted', tone: 'withdrawn', date: shortlistDate });
    return { pill, segments, summary: 'withdrawn', summaryDate: withdrawnDate };
  }

  if (status === 'rejected') {
    const segments: ProgressSegment[] = [
      { key: 'sent', tone: 'done', date: application.created_at },
      { key: 'seen', tone: 'done', date: application.employer_viewed_at },
    ];
    if (shortlist) segments.push({ key: 'shortlisted', tone: 'done', date: shortlistDate });
    segments.push({ key: 'decision', tone: 'rejected', date: rejectedDate });
    return { pill, segments, summary: 'rejected', summaryDate: rejectedDate };
  }

  const reached = {
    sent: true,
    seen,
    shortlisted: shortlist,
    decision: status === 'hired',
  } as const;
  const dates: Record<ProgressStepKey, string | null> = {
    sent: application.created_at,
    seen: application.employer_viewed_at,
    shortlisted: shortlistDate,
    decision: hiredDate,
  };
  const order: ProgressStepKey[] = ['sent', 'seen', 'shortlisted', 'decision'];
  const firstOpen = order.findIndex((key) => !reached[key]);
  const segments: ProgressSegment[] = order.map((key, index) => ({
    key,
    tone: reached[key] ? 'done' : index === firstOpen ? 'current' : 'upcoming',
    date: reached[key] ? dates[key] : null,
  }));

  const summary: ProgressSummary = status === 'hired' ? 'hired' : shortlist ? 'shortlisted' : seen ? 'seen' : 'sent';
  const summaryDate =
    summary === 'hired' ? hiredDate : summary === 'shortlisted' ? shortlistDate : summary === 'seen' ? application.employer_viewed_at : application.created_at;

  return { pill, segments, summary, summaryDate };
}
