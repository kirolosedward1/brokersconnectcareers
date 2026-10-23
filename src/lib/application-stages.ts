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
