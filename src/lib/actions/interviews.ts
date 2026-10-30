'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { publish } from '@/lib/notifications/events';
import { logFailure, refused } from '@/lib/observe';
import { clean } from '@/lib/security/sanitize';

/**
 * Interview invitations (migration 373, docs/design/v1.1/phase-b/09).
 *
 * The company invites a candidate to a time, at the office, by phone or by
 * video; the candidate accepts, declines or proposes another time; the
 * company may accept that time, or cancel. Times are instants and are shown
 * in Cairo time everywhere (decided). The bell and the push for each step
 * are written by the database (on_interview_changed), in the transaction
 * that makes the step, so nothing here can forget them.
 *
 * Who may do what is the database's: the company's side goes through its
 * members' policy (owns_job), the candidate's through answer_interview(),
 * which can change nothing but the answer.
 */

/** Ninety days ahead at most: further than that is not an invitation, it is a guess. */
const AHEAD_MS = 90 * 86_400_000;

const instant = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    const at = Date.parse(value);
    return at > Date.now() && at < Date.now() + AHEAD_MS;
  }, 'not_in_window');

const inviteSchema = z.object({
  applicationId: z.string().uuid(),
  startsAt: instant,
  minutes: z.number().int().min(10).max(240),
  mode: z.enum(['office', 'phone', 'video']),
  place: z.string().trim().max(300).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/** The stages an invitation moves an application on from; later ones stay where they are. */
const BEFORE_INTERVIEW = ['new', 'shortlisted'] as const;

/**
 * Invite to an interview. One invitation stands per application: one already
 * waiting or agreed is cancelled by the new one, which is how a company
 * changes the time. The application moves to the interview stage if it was
 * still before it, which sends the candidate the stage's own email.
 */
export async function inviteToInterview(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    const window = parsed.error.issues.some((issue) => issue.message === 'not_in_window');
    return { ok: false, error: window ? 'time_not_allowed' : 'invalid' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Readable only to the company that owns the listing (RLS): anyone else is told nothing exists.
  const { data: application } = await supabase
    .from('applications')
    .select('id, status')
    .eq('id', parsed.data.applicationId)
    .maybeSingle();
  if (!application) return { ok: false, error: 'forbidden' };
  if (application.status === 'withdrawn' || application.status === 'rejected' || application.status === 'hired') {
    return { ok: false, error: 'closed' };
  }

  const { error: cancelError } = await supabase
    .from('interview_invites')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('application_id', parsed.data.applicationId)
    .in('status', ['proposed', 'accepted', 'counter']);
  if (cancelError) return refused('interview', cancelError, { application: parsed.data.applicationId });

  const { data: invite, error } = await supabase
    .from('interview_invites')
    .insert({
      application_id: parsed.data.applicationId,
      starts_at: new Date(parsed.data.startsAt).toISOString(),
      minutes: parsed.data.minutes,
      mode: parsed.data.mode,
      place: clean(parsed.data.place ?? '', true) || null,
      note: clean(parsed.data.note ?? '', true) || null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !invite) return refused('interview', error ?? {}, { application: parsed.data.applicationId });

  if ((BEFORE_INTERVIEW as readonly string[]).includes(application.status)) {
    const { data: moved, error: moveError } = await supabase
      .from('applications')
      .update({ status: 'interview', employer_viewed_at: new Date().toISOString() })
      .eq('id', parsed.data.applicationId)
      .in('status', [...BEFORE_INTERVIEW])
      .select('id');
    if (moveError) {
      logFailure('interview', 'stage not moved with the invitation', { application: parsed.data.applicationId });
    } else if (moved?.length) {
      after(() => publish({ type: 'APPLICATION_STATUS_CHANGED', applicationId: parsed.data.applicationId }));
    }
  }

  revalidatePath('/employer/jobs');
  revalidatePath('/dashboard/applications');
  return { ok: true, data: { id: invite.id as string } };
}

const idSchema = z.object({ id: z.string().uuid() });

/** The company takes an invitation back. Says nothing to the candidate beyond the invitation's state. */
export async function cancelInterview(input: unknown): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('interview_invites')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .in('status', ['proposed', 'accepted', 'counter'])
    .select('id');
  if (error) return refused('interview', error, { interview: parsed.data.id });
  if (!data?.length) return { ok: false, error: 'closed' };
  revalidatePath('/dashboard/applications');
  return { ok: true };
}

/** The company agrees to the time the candidate proposed: it becomes the time, agreed. */
export async function acceptProposedTime(input: unknown): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const { data: invite } = await supabase
    .from('interview_invites')
    .select('id, status, counter_starts_at')
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!invite) return { ok: false, error: 'forbidden' };
  if (invite.status !== 'counter' || !invite.counter_starts_at) return { ok: false, error: 'closed' };
  if (Date.parse(invite.counter_starts_at as string) <= Date.now()) return { ok: false, error: 'time_not_allowed' };

  const { data, error } = await supabase
    .from('interview_invites')
    .update({ starts_at: invite.counter_starts_at, status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('status', 'counter')
    .select('id');
  if (error) return refused('interview', error, { interview: parsed.data.id });
  if (!data?.length) return { ok: false, error: 'closed' };
  revalidatePath('/dashboard/applications');
  return { ok: true };
}

const answerSchema = z
  .object({
    id: z.string().uuid(),
    answer: z.enum(['accepted', 'declined', 'counter']),
    counterStartsAt: instant.optional().nullable(),
  })
  .refine((value) => value.answer !== 'counter' || Boolean(value.counterStartsAt), 'counter_needs_time');

/** The candidate's answer: accept, decline, or propose another time. */
export async function answerInterview(input: unknown): Promise<ActionResult> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) {
    const window = parsed.error.issues.some((issue) => issue.message === 'not_in_window');
    return { ok: false, error: window ? 'time_not_allowed' : 'invalid' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('answer_interview', {
    p_id: parsed.data.id,
    p_answer: parsed.data.answer,
    p_counter: parsed.data.counterStartsAt ? new Date(parsed.data.counterStartsAt).toISOString() : null,
  });
  if (error) return refused('interview', error, { interview: parsed.data.id });
  if (data === 'not_found') return { ok: false, error: 'forbidden' };
  if (data === 'closed') return { ok: false, error: 'closed' };
  if (data !== 'ok') return { ok: false, error: 'invalid' };
  revalidatePath('/dashboard/applications');
  return { ok: true };
}
