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

/** Every stage, in the order the pipeline runs and the product counts them. */
export const APPLICATION_STAGES = [
  'new',
  'shortlisted',
  'interview',
  'hired',
  'rejected',
] as const satisfies readonly ApplicationStatus[];

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
};

/**
 * Withdrawing is offered only while the outcome is still open. The database's
 * withdrawal precondition (migration 42) is what enforces it; this decides
 * whether the button is drawn.
 */
export function canWithdraw(status: ApplicationStatus): boolean {
  return status === 'new' || status === 'shortlisted';
}
