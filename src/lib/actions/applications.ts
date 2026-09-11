'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { normalisePhone, isValidPhone } from '@/lib/phone';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';
import {
  notifyApplicationWithdrawn,
  notifyCandidateOfApplication,
  notifyCandidateOfStatus,
  notifyEmployerOfApplication,
} from '@/lib/email/notify';
import type { ApplicationStatus, ExperienceBand } from '@/lib/supabase/database.types';
import { logFailure } from '@/lib/observe';

const applySchema = z.object({
  jobId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(6).max(24),
  experienceBand: z.enum(EXPERIENCE_BANDS),
  cvPath: z.string().trim().max(512).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * Apply in under 60 seconds: name, WhatsApp, experience band. The CV is
 * optional and there is no cover letter field, by design.
 */
export async function applyToJob(input: unknown): Promise<ActionResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    /*
      Name the field. A phone of "123" fails the schema's min(6) before the
      phone validator below ever runs, and this branch used to return no
      fieldErrors — so the form fell back to "we couldn't complete that, try
      again" at the bottom of the page, with the offending field a screen
      above it and nothing pointing there. The keys are the form's own field
      names and the values are the validation messages it already renders.
    */
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (!field || fieldErrors[field]) continue;
      fieldErrors[field] = field === 'whatsapp' ? 'invalidPhone' : 'required';
    }
    return { ok: false, error: 'invalid', fieldErrors };
  }

  const phone = normalisePhone(parsed.data.whatsapp);
  if (!isValidPhone(phone)) {
    return { ok: false, error: 'invalid', fieldErrors: { whatsapp: 'invalidPhone' } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // A CV path must sit under the applicant's own folder. Without this check a
  // crafted request could attach someone else's file to an application.
  if (parsed.data.cvPath && !parsed.data.cvPath.startsWith(`${user.id}/`)) {
    return { ok: false, error: 'invalid_cv_path' };
  }

  const { data: created, error } = await supabase
    .from('applications')
    .insert({
      job_id: parsed.data.jobId,
      candidate_id: user.id,
      experience_band: parsed.data.experienceBand as ExperienceBand,
      cv_path: parsed.data.cvPath || null,
      note: parsed.data.note || null,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'already_applied' };
    if (error.message.includes('application_rate_limit')) {
      return { ok: false, error: 'rate_limit' };
    }

    /*
      The one mutation this product exists for, and until now it failed in
      silence: the applicant saw "something went wrong" and the server kept no
      record of what. A refusal that is neither a duplicate nor a rate limit is
      almost always a policy the request did not satisfy — an expired listing,
      a suspended account — and none of that is diagnosable from the outside.

      Ids and codes. The listing and the applicant are how somebody finds the
      row; nothing they typed goes anywhere near this line.
    */
    logFailure('apply', 'application refused', {
      job: parsed.data.jobId,
      candidate: user.id,
      code: error.code,
    });
    return { ok: false, error: error.message };
  }

  /*
    Applying is also the moment people correct a stale phone number — and it
    happens here, after the application exists, rather than before it.

    Written first, this rewrote the profile of anyone whose application was
    then refused: a second application to the same listing, a rate limit, a
    listing that expired while the form was open. The name and number on the
    account changed on the strength of a form that did not go through, and
    every employer holding an earlier application from them saw the new one.
  */
  await supabase
    .from('profiles')
    .update({ full_name: parsed.data.fullName, whatsapp_phone: phone })
    .eq('id', user.id);

  // after() runs once the response is on its way, so the applicant is not kept
  // waiting on an SMTP round trip — and a mail failure cannot turn a recorded
  // application into an error on their screen.
  if (created) {
    after(() => notifyEmployerOfApplication(created.id));
    // The applicant hears back too. Until now the next thing they heard was
    // whatever an employer eventually did, which on a listing nobody opens is
    // nothing at all.
    after(() => notifyCandidateOfApplication(created.id));
  }

  revalidatePath('/dashboard/applications');
  return { ok: true };
}

export async function withdrawApplication(applicationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Read the title before the delete, not after: withdrawing removes the row,
  // and the confirmation has to name the role the person just withdrew from.
  // Through the caller's session, so this reads nothing RLS would not already
  // show them.
  const { data: before } = await supabase
    .from('applications')
    .select('id, job:jobs (title_ar, title_en)')
    .eq('id', applicationId)
    .maybeSingle();

  // Same reason as the pipeline move: a delete RLS filters to zero rows is not
  // an error, so "withdrawn" was reported for an application still sitting in
  // an employer's inbox.
  const { data: removed, error } = await supabase
    .from('applications')
    .delete()
    .eq('id', applicationId)
    .select('id');

  if (error) return { ok: false, error: error.message };

  if (!removed?.length) {
    // Refused by the withdrawal precondition migration 42 added, or by
    // somebody reaching for an application that is not theirs. Both are worth
    // seeing; neither is worth a name in the log.
    logFailure('apply', 'withdrawal refused', { application: applicationId, by: user?.id });
    return { ok: false, error: 'forbidden' };
  }

  const job = (before as unknown as WithdrawnJob | null)?.job;
  if (user && job) {
    const titleAr = job.title_ar;
    const titleEn = job.title_en;
    after(() =>
      notifyApplicationWithdrawn({
        userId: user.id,
        applicationId,
        jobTitleAr: titleAr,
        jobTitleEn: titleEn,
      }),
    );
  }

  // Both sides. The employer's inbox and the pipeline counts on their console
  // are one applicant lighter than they were a moment ago, and until this was
  // here they stayed that way until something else happened to refetch them.
  revalidatePath('/dashboard/applications');
  revalidatePath('/employer/jobs');
  revalidatePath('/employer/applicants');
  return { ok: true };
}

/** The embed above, which the generated types resolve as an array. */
type WithdrawnJob = { id: string; job: { title_ar: string; title_en: string | null } | null };

const statusSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(['new', 'shortlisted', 'interview', 'hired', 'rejected']),
  /** Optional, and deliberately so — a required field becomes "not a fit" forever. */
  decisionNote: z.string().trim().max(500).optional().nullable(),
  /**
   * The status the card was showing when somebody chose the new one.
   *
   * A company is a team and any member may work the inbox, so two recruiters
   * on the same applicant is an ordinary Tuesday rather than a contrived race.
   * Without this the second move silently replaced the first, each person kept
   * their own optimistic value until they happened to refresh, and the
   * candidate was emailed twice about two different outcomes.
   */
  from: z.enum(['new', 'shortlisted', 'interview', 'hired', 'rejected']).optional(),
});

/** Employer pipeline move. RLS restricts this to jobs the caller owns. */
export async function setApplicationStatus(input: unknown): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();

  // Compare and swap, in one statement: matching the status the card rendered
  // makes "somebody moved this first" a refusal rather than an overwrite, and
  // leaves no window between checking and writing.
  const query = supabase
    .from('applications')
    .update({
      status: parsed.data.status as ApplicationStatus,
      employer_viewed_at: new Date().toISOString(),
      decision_note: parsed.data.decisionNote?.trim() || null,
    })
    .eq('id', parsed.data.applicationId);

  const { data: moved, error } = await (
    parsed.data.from ? query.eq('status', parsed.data.from) : query
  )
    // Asked, not assumed. RLS scopes this to applications on the caller's own
    // listings, and an update it filters to zero rows returns no error — so
    // without this the function reported success for a move that never
    // happened and then emailed the candidate to say their application had
    // moved. A false notification is worse than a failed one.
    .select('id');

  if (error) return { ok: false, error: error.message };

  if (!moved?.length) {
    // Zero rows means one of two things and the reader deserves to know which:
    // somebody else moved it, or it was never theirs to move.
    const { data: current } = await supabase
      .from('applications')
      .select('status')
      .eq('id', parsed.data.applicationId)
      .maybeSingle();

    logFailure('pipeline', current ? 'move lost the race' : 'move refused', {
      application: parsed.data.applicationId,
      from: parsed.data.from,
      to: parsed.data.status,
      now: current?.status,
    });

    return { ok: false, error: current ? 'moved_already' : 'forbidden' };
  }

  after(() => notifyCandidateOfStatus(parsed.data.applicationId));

  revalidatePath('/employer/jobs');
  revalidatePath('/dashboard/applications');
  return { ok: true };
}
