'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { normalisePhone, isValidPhone } from '@/lib/phone';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import type { ActionResult } from '@/lib/actions/jobs';
import { CV_BUCKET } from '@/lib/buckets';
import { CV_KINDS, MAX_BYTES, isOwnedPath, verifyStoredObject } from '@/lib/security/files';
import { cvInUse } from '@/lib/cv-in-use';
import { recordSecurityEvent } from '@/lib/security/events';
import { clean } from '@/lib/security/sanitize';
import { publish } from '@/lib/notifications/events';
import type {
  ApplicationNoteRow,
  ApplicationStatus,
  ExperienceBand,
} from '@/lib/supabase/database.types';
import { logFailure } from '@/lib/observe';
import { PIPELINE_STAGES } from '@/lib/application-stages';
import { insertOnce } from '@/lib/actions/idempotency';
import { jobIsLive } from '@/lib/job-state';
import { refused } from '@/lib/observe';
import { allow } from '@/lib/rate-limit';

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

  /*
    A CV path is the applicant's own folder and one file name — not a prefix
    match, which `<me>/../<someone>/cv.pdf` satisfies and the storage client
    sends without encoding. And the object behind it is looked at: the bucket
    trusts the type the browser declared, this reads the first bytes and
    accepts a PDF or a Word document and nothing wearing their extension. A
    refusal removes the object so it does not sit in the bucket under a name
    the platform once accepted.
  */
  if (parsed.data.cvPath) {
    if (!isOwnedPath(parsed.data.cvPath, user.id)) return { ok: false, error: 'invalid_cv_path' };

    // Judged like any file, but a CV the caller's rows already point at is
    // never deleted for failing the check (cv-in-use.ts).
    const keep = await cvInUse(
      {
        profileCv: () => supabase.from('agent_profiles').select('cv_path').eq('user_id', user.id).maybeSingle(),
        applicationsWith: async (path) => {
          const result = await supabase
            .from('applications')
            .select('id, status')
            .eq('candidate_id', user.id)
            .eq('cv_path', path)
            .limit(5);
          return {
            ...result,
            data: result.data?.filter((row) => row.status !== 'withdrawn').slice(0, 1) ?? null,
          };
        },
      },
      parsed.data.cvPath,
    );
    const verdict = await verifyStoredObject(CV_BUCKET, parsed.data.cvPath, CV_KINDS, MAX_BYTES.cv, { keep });
    if (!verdict.ok && verdict.reason !== 'unavailable') {
      void recordSecurityEvent('upload.rejected', {
        actorId: user.id,
        metadata: { kind: 'cv', reason: verdict.reason, sniffed: verdict.kind ?? null },
      });
      return { ok: false, error: 'invalid', fieldErrors: { cv: 'fileType' } };
    }
  }

  const { data: created, error } = await supabase
    .from('applications')
    .insert({
      job_id: parsed.data.jobId,
      candidate_id: user.id,
      experience_band: parsed.data.experienceBand as ExperienceBand,
      cv_path: parsed.data.cvPath || null,
      note: clean(parsed.data.note, true) || null,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'already_applied' };
    if (error.message.includes('application_rate_limit')) {
      return { ok: false, error: 'rate_limit' };
    }
    // The company has paused hiring (migration 378): no form can fix that, so it is named.
    if (error.message.includes('company_paused')) return { ok: false, error: 'company_paused' };

    /*
      A refusal by policy (42501) is almost always the listing: it closed,
      was paused, or ran past its end date while the form was open. "Try
      again" can never work then, so it is asked once and named — 'not_open'
      — and the person is told the listing stopped taking applications. The
      raw database text stays here rather than travelling to the browser.

      Only when the listing was actually read. A lookup that failed says
      nothing about the listing, and 'not_open' makes the form throw away
      what was typed — so a passing database error falls through to the
      ordinary, retryable 'failed' below.
    */
    if (error.code === '42501') {
      const { data: listing, error: listingError } = await supabase
        .from('jobs')
        .select('status, expires_at')
        .eq('id', parsed.data.jobId)
        .maybeSingle();
      if (!listingError && (!listing || !jobIsLive(listing))) return { ok: false, error: 'not_open' };
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
    return { ok: false, error: 'failed' };
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
    .update({ full_name: clean(parsed.data.fullName), whatsapp_phone: phone })
    .eq('id', user.id);

  // after() runs once the response is on its way, so the applicant is not kept
  // waiting on an SMTP round trip — and a mail failure cannot turn a recorded
  // application into an error on their screen.
  if (created) {
    // One event, two audiences: the company (NEW_APPLICANT) and the applicant's
    // own receipt. Which channels carry each is the notification service's
    // decision, not this action's.
    const applicationId = created.id;
    after(() => publish({ type: 'APPLICATION_CREATED', applicationId }));
  }

  revalidatePath('/dashboard/applications');
  return { ok: true };
}

export async function withdrawApplication(applicationId: string): Promise<ActionResult> {
  // Called from the app over /api/mobile/v1 too, so the id is not trusted.
  if (!z.string().uuid().safeParse(applicationId).success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The title, through the caller's session, so this reads nothing RLS would
  // not already show them. The row stays; the confirmation still has to name
  // the role.
  const { data: before } = await supabase
    .from('applications')
    .select('id, cv_path, job:jobs (title_ar, title_en)')
    .eq('id', applicationId)
    .maybeSingle();

  // The function marks the row withdrawn and clears cv_path. An empty result
  // is a refusal — not theirs, or past shortlisted — and is not an error, so
  // "withdrawn" is not reported for a row that did not change. Deleting the
  // row is not a fallback: that is the history this action exists to keep,
  // and the candidate delete policy is gone. A database without the function
  // yet is told so, and the application stays.
  const { data: withdrawnRows, error } = await supabase.rpc('withdraw_application', { p_id: applicationId });

  if (error && (error.code === 'PGRST202' || error.code === '42883')) {
    logFailure('apply', 'withdraw_application is not available', { application: applicationId, code: error.code });
    return { ok: false, error: 'unavailable' };
  }
  if (error) return refused('application', error, { application: applicationId });
  if (!withdrawnRows?.length) {
    logFailure('apply', 'withdrawal refused', { application: applicationId, by: user?.id });
    return { ok: false, error: 'forbidden' };
  }

  const withdrawn = before as unknown as WithdrawnJob | null;
  const cvPath = withdrawnRows?.[0]?.previous_cv_path ?? withdrawn?.cv_path ?? null;
  if (user && cvPath) {
    await removeOrphanedCv(supabase, user.id, cvPath, applicationId);
  }

  const job = withdrawn?.job;
  if (user && job) {
    const titleAr = job.title_ar;
    const titleEn = job.title_en;
    after(() =>
      publish({
        type: 'APPLICATION_WITHDRAWN',
        candidateId: user.id,
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
type WithdrawnJob = {
  id: string;
  cv_path: string | null;
  job: { title_ar: string; title_en: string | null } | null;
};

/**
 * The CV a withdrawn application carried, deleted once nothing points at it.
 *
 * Every application can upload its own CV, to a fresh name in the candidate's
 * private folder, and withdrawing deleted the row but never the file — so a
 * personal document stayed in storage with no row referring to it, no screen
 * showing it and no job ever cleaning it up, until the account itself went.
 *
 * Only when no other application of theirs and not their directory profile
 * still uses the same file: reusing the profile CV to apply is the common
 * case, and that file is not the application's to delete. Through the
 * caller's session, as the rest of this action is — the `cvs` policy lets a
 * candidate manage exactly their own folder, and the prefix check keeps this
 * to it. Done before responding rather than in after(), because the session
 * client reads cookies and after() must not; it is two reads and a delete.
 *
 * Never fails the withdrawal. A file left behind is the old behaviour, and it
 * is logged by id so it can be found.
 */
async function removeOrphanedCv(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cvPath: string,
  applicationId: string,
) {
  if (!cvPath.startsWith(`${userId}/`)) return;
  try {
    const [others, profile] = await Promise.all([
      supabase
        .from('applications')
        .select('id, status')
        .eq('candidate_id', userId)
        .eq('cv_path', cvPath)
        .limit(5),
      supabase
        .from('agent_profiles')
        .select('id')
        .eq('user_id', userId)
        .eq('cv_path', cvPath)
        .limit(1),
    ]);
    // Unknown is not "unused": a failed read keeps the file.
    if (others.error || profile.error) {
      logFailure('apply', 'could not check a withdrawn cv', {
        application: applicationId,
        code: others.error?.code ?? profile.error?.code,
      });
      return;
    }
    // A withdrawn row is not holding the file, even if its cv_path has not
    // been cleared yet. A standing application, or the profile, is.
    if (others.data.some((row) => row.status !== 'withdrawn') || profile.data.length) return;

    const { error } = await supabase.storage.from('cvs').remove([cvPath]);
    if (error) {
      logFailure('apply', 'could not remove a withdrawn cv', { application: applicationId });
    }
  } catch {
    logFailure('apply', 'could not remove a withdrawn cv', { application: applicationId });
  }
}

const statusSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(PIPELINE_STAGES),
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
  from: z.enum(PIPELINE_STAGES).optional(),
  /**
   * Whether the candidate may read the reason (v1.1 Phase B, decided: the
   * employer ticks it). Absent means yes, as every form before the tick sent.
   * Unticked, the reason is not written to `decision_note` — which the
   * candidate's own select policy returns with the row — but kept as one of
   * the company's notes on the application (migration 58), which they never see.
   */
  shareReason: z.boolean().optional(),
});

/** Employer pipeline move. RLS restricts this to jobs the caller owns. */
export async function setApplicationStatus(input: unknown): Promise<ActionResult<{ reasonKept: boolean }>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const reason = clean(parsed.data.decisionNote, true) || null;
  const shared = parsed.data.shareReason !== false;

  // Compare and swap, in one statement: matching the status the card rendered
  // makes "somebody moved this first" a refusal rather than an overwrite, and
  // leaves no window between checking and writing.
  const query = supabase
    .from('applications')
    .update({
      status: parsed.data.status as ApplicationStatus,
      employer_viewed_at: new Date().toISOString(),
      decision_note: shared ? reason : null,
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

  if (error) return refused('application', error, { application: parsed.data.applicationId });

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

  // Kept from the candidate: the reason becomes the company's own note on the
  // application. Written after the move, which is the decision; a note that
  // fails is said (reasonKept: false) rather than taking the move back.
  let reasonKept = true;
  if (!shared && reason) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: noteError } = user
      ? await supabase.from('application_notes').insert({ application_id: parsed.data.applicationId, author_id: user.id, body: reason })
      : { error: new Error('unauthenticated') };
    if (noteError) {
      reasonKept = false;
      logFailure('pipeline', 'private reason not kept', { application: parsed.data.applicationId });
    }
  }

  after(() => publish({ type: 'APPLICATION_STATUS_CHANGED', applicationId: parsed.data.applicationId }));

  revalidatePath('/employer/jobs');
  revalidatePath('/dashboard/applications');
  revalidatePath('/admin', 'layout');
  return { ok: true, data: { reasonKept } };
}


const bulkSchema = z.object({
  items: z
    .array(z.object({ applicationId: z.string().uuid(), from: z.enum(PIPELINE_STAGES) }))
    .min(1)
    .max(50),
  status: z.enum(PIPELINE_STAGES),
  decisionNote: z.string().trim().max(500).optional().nullable(),
  shareReason: z.boolean().optional(),
});

/**
 * Several applicants moved at once (Phase B 01): each exactly as a single
 * move — compared and swapped on the stage its card showed, its reason shared
 * or kept by the same tick, its candidate told as a single move tells them —
 * so a batch is fifty ordinary moves, not a second set of rules. Fifty at
 * most; the counts say what happened to each.
 */
export async function setApplicationStatuses(
  input: unknown,
): Promise<ActionResult<{ moved: number; movedAlready: number; failed: number; reasonsNotKept: number }>> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  if (!(await allow(`applications_bulk:${user.id}`, 30, 3600))) return { ok: false, error: 'rate_limited' };

  const counts = { moved: 0, movedAlready: 0, failed: 0, reasonsNotKept: 0 };
  for (const item of parsed.data.items) {
    const result = await setApplicationStatus({
      applicationId: item.applicationId,
      status: parsed.data.status,
      decisionNote: parsed.data.decisionNote ?? null,
      from: item.from,
      ...(parsed.data.shareReason === false ? { shareReason: false } : {}),
    });
    if (result.ok) {
      counts.moved += 1;
      if (result.data && !result.data.reasonKept) counts.reasonsNotKept += 1;
    } else if (result.error === 'moved_already') counts.movedAlready += 1;
    else counts.failed += 1;
  }
  return { ok: true, data: counts };
}

const messageSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(50),
  message: z.string().trim().min(2).max(1000),
  /** Made once when the composer opens, so a retried send is the same message. */
  key: z.string().uuid(),
});

/**
 * One message to several applicants, by email (Phase B 01: email only,
 * decided). Only to the company's own applicants — the read is under RLS, so
 * an id that is not theirs simply is not found — and never to one who has
 * withdrawn. Sent from the event bus like every other email.
 */
export async function messageApplicants(input: unknown): Promise<ActionResult<{ sent: number; skipped: number }>> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  if (!(await allow(`applicant_messages:${user.id}`, 300, 86400))) return { ok: false, error: 'rate_limited' };

  const { data, error } = await supabase
    .from('applications')
    .select('id, status')
    .in('id', parsed.data.applicationIds);
  if (error) return refused('pipeline', error, { count: parsed.data.applicationIds.length });

  const message = clean(parsed.data.message, true);
  if (!message) return { ok: false, error: 'invalid' };
  const reachable = (data ?? []).filter((row) => row.status !== 'withdrawn').map((row) => row.id as string);
  after(async () => {
    for (const applicationId of reachable) {
      await publish({ type: 'COMPANY_MESSAGE_SENT', applicationId, message, key: parsed.data.key });
    }
  });
  return { ok: true, data: { sent: reachable.length, skipped: parsed.data.applicationIds.length - reachable.length } };
}

const candidateNoteSchema = z.object({
  applicationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * A note about the person (migration 375, Phase B 02): written on one of
 * their applications, read on every application they send the company, by
 * the whole company (decided), never by them. The person and the company
 * come from the application, read under RLS, so the client never names
 * either; the policy decides whether it may be written at all.
 */
export async function addCandidateNote(input: unknown): Promise<ActionResult<{ id: number }>> {
  const parsed = candidateNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: application } = await supabase
    .from('applications')
    .select('candidate_id, job:jobs (company_id)')
    .eq('id', parsed.data.applicationId)
    .maybeSingle();
  const row = application as unknown as { candidate_id: string; job: { company_id: string } | null } | null;
  if (!row?.job) return { ok: false, error: 'forbidden' };

  const body = clean(parsed.data.body, true);
  if (!body) return { ok: false, error: 'invalid' };
  const note = { company_id: row.job.company_id, candidate_id: row.candidate_id, author_id: user.id, body };
  const key = parsed.data.idempotencyKey;
  const { data, error } = await insertOnce(
    key,
    (withKey) =>
      supabase
        .from('company_candidate_notes')
        .insert({ ...note, ...(withKey ? { idempotency_key: key } : {}) })
        .select('id')
        .single(),
    () =>
      supabase.from('company_candidate_notes').select('id').eq('company_id', note.company_id).eq('idempotency_key', key!).maybeSingle(),
  );
  if (error || !data) return refused('notes', error ?? {}, { application: parsed.data.applicationId });
  return { ok: true, data: { id: (data as { id: number }).id } };
}

export async function deleteCandidateNote(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('company_candidate_notes').delete().eq('id', parsed.data.id).select('id');
  if (error) return refused('notes', error, { note: parsed.data.id });
  if (!data?.length) return { ok: false, error: 'forbidden' };
  return { ok: true };
}

const noteSchema = z.object({
  applicationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
  // Made once when the composer opens, so a retry after a lost answer finds
  // the note the first attempt wrote rather than writing it twice.
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * A note about an applicant that the applicant never sees.
 *
 * The one note field that existed, `decision_note`, is read by the candidate —
 * it is how a rejection says why, which is the point of the board. This is the
 * other kind: "called, no answer, try Thursday", the thing that makes comparing
 * twelve applicants possible and that must not be sent to any of them.
 *
 * Nothing here checks whether the caller may write it. application_notes_write
 * requires the row's author to be the caller and the application to be on one
 * of their company's listings, so a forged applicationId is refused by the
 * database rather than by a check this function remembered to make.
 */
export async function addApplicationNote(
  input: unknown,
): Promise<ActionResult<{ note: ApplicationNoteRow }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  /*
    The whole row back, not just its id.

    The card renders the note the moment this returns, and rendering it needs a
    timestamp and an author. Inventing either in the browser would put a time
    on screen that is not the time in the database — close enough to look right
    and wrong under any comparison. So the row it wrote is the row it answers
    with, and nothing is fabricated.
  */
  const key = parsed.data.idempotencyKey;
  const note = {
    application_id: parsed.data.applicationId,
    author_id: user.id,
    body: clean(parsed.data.body, true),
  };
  const { data, error } = await insertOnce(
    key,
    (withKey) =>
      supabase
        .from('application_notes')
        .insert({ ...note, ...(withKey ? { idempotency_key: key } : {}) })
        .select('*')
        .single(),
    () =>
      supabase
        .from('application_notes')
        .select('*')
        .eq('application_id', parsed.data.applicationId)
        .eq('author_id', user.id)
        .eq('idempotency_key', key!)
        .maybeSingle(),
  );

  if (error || !data) {
    logFailure('pipeline', 'note refused', {
      application: parsed.data.applicationId,
      by: user.id,
      code: error?.code,
    });
    return { ok: false, error: 'forbidden' };
  }

  revalidatePath('/employer/applicants');
  revalidatePath('/employer/jobs');
  return { ok: true, data: { note: data as ApplicationNoteRow } };
}

/**
 * Removing one, which only its author may do.
 *
 * A note is somebody's observation; a colleague deleting it is a different act
 * from tidying up your own, and the policy says so. `.select()` because a
 * delete RLS filters to nothing carries no error — the mistake this codebase
 * keeps meeting.
 */
export async function deleteApplicationNote(id: number): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: removed, error } = await supabase
    .from('application_notes')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) return refused('application', error, { note: id });
  if (!removed?.length) return { ok: false, error: 'forbidden' };

  revalidatePath('/employer/applicants');
  revalidatePath('/employer/jobs');
  return { ok: true };
}
