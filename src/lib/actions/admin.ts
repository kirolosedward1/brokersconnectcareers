'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import {
  notifyAccountDecision,
  notifyCompanyVerification,
  notifyEmployerOfModeration,
} from '@/lib/email/notify';

/**
 * Every action here runs through the caller's own session, not the service
 * role. The admin RLS policies and the acting_as_admin() bypass in the guard
 * triggers are what grant the privilege, so a non-admin who reaches these
 * functions is refused by the database rather than by a check we might forget.
 */
async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return profile?.role === 'admin' ? supabase : null;
}

const moderateSchema = z.object({
  jobId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export async function moderateJob(input: unknown): Promise<ActionResult> {
  const parsed = moderateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data: moderated, error } = await supabase
    .from('jobs')
    .update(
      parsed.data.approve
        ? { status: 'active', rejection_note: null }
        : { status: 'rejected', rejection_note: parsed.data.note || null },
    )
    .eq('id', parsed.data.jobId)
    // An id that matches nothing is not a successful moderation. Without this
    // the reviewer was told it worked and the employer was emailed about a
    // decision on a listing that does not exist.
    .select('id');

  if (error) {
    // The unverified-company post cap is enforced in the database, so approving
    // a second listing from an unverified company fails here rather than
    // silently overriding the rule. Name it, so the reviewer knows to verify
    // the company first.
    if (error.message.includes('unverified_company_post_cap')) {
      return { ok: false, error: 'post_cap' };
    }
    return { ok: false, error: error.message };
  }

  if (!moderated?.length) return { ok: false, error: 'not_found' };

  // The employer has been waiting on this decision; it is the one moderation
  // outcome they actually need pushed to them rather than discovered.
  after(() => notifyEmployerOfModeration(parsed.data.jobId, parsed.data.approve, parsed.data.note));

  revalidatePath('/admin/jobs');
  revalidatePath('/jobs');
  return { ok: true };
}

const featureSchema = z.object({ jobId: z.string().uuid(), featured: z.boolean() });

export async function setJobFeatured(input: unknown): Promise<ActionResult> {
  const parsed = featureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data: featured, error } = await supabase
    .from('jobs')
    .update({
      is_featured: parsed.data.featured,
      // 14 days pinned, per the featured add-on. Clearing the flag clears the
      // window so a later re-feature starts fresh.
      featured_until: parsed.data.featured
        ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        : null,
    })
    .eq('id', parsed.data.jobId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!featured?.length) return { ok: false, error: 'not_found' };

  revalidatePath('/admin/jobs');
  return { ok: true };
}

const verifySchema = z.object({
  companyId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export async function verifyCompany(input: unknown): Promise<ActionResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: verified, error } = await supabase
    .from('companies')
    .update({
      verification_status: parsed.data.approve ? 'verified' : 'rejected',
      verified_at: parsed.data.approve ? new Date().toISOString() : null,
    })
    .eq('id', parsed.data.companyId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  // A company id that matches nothing is not a completed review.
  if (!verified?.length) return { ok: false, error: 'not_found' };

  await supabase
    .from('company_documents')
    .update({
      status: parsed.data.approve ? 'verified' : 'rejected',
      review_note: parsed.data.note || null,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('company_id', parsed.data.companyId)
    .eq('status', 'pending');

  // The owner is told what the review decided. Transactional: a company left
  // waiting on verification has no other way to find out, and the bell only
  // helps somebody who is already logged in and looking.
  after(() => notifyCompanyVerification(parsed.data.companyId, parsed.data.approve, parsed.data.note));

  revalidatePath('/admin/companies');
  revalidatePath('/companies');
  return { ok: true };
}

const reportedJobSchema = z.object({
  jobId: z.string().uuid(),
  takeDown: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Close out every open report on one listing, optionally taking it down.
 *
 * The queue used to resolve reports one at a time, and its only verb was
 * "resolve" — which marks the complaint handled and leaves the listing exactly
 * where it was. A reviewer reading "this advert is a fake" had nothing on that
 * screen to act with: they had to remember the title, cross to the jobs queue,
 * switch it to the active tab, and find it in an unpaginated list. The
 * realistic outcome of that walk is that the report gets closed and the fake
 * advert stays up.
 *
 * Reports are also one-per-person — there is a unique index on
 * (job_id, reporter_id) — so five reports on a listing are five different
 * people, which is the strongest signal the queue has. Handling them
 * individually threw it away and made the reviewer close the same complaint
 * five times.
 *
 * So the unit of work is the listing, not the row: both verbs act on every
 * open report at once, and taking down means the listing actually comes down.
 */
export async function actOnReportedJob(input: unknown): Promise<ActionResult<{ tookDown: boolean }>> {
  const parsed = reportedJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let tookDown = false;

  if (parsed.data.takeDown) {
    const { data: rejected, error } = await supabase
      .from('jobs')
      .update({ status: 'rejected', rejection_note: parsed.data.note || null })
      .eq('id', parsed.data.jobId)
      // Already rejected is not a second rejection. Without this the employer
      // is emailed again every time a later report on a listing that is
      // already down gets cleared.
      .neq('status', 'rejected')
      .select('id');

    if (error) return { ok: false, error: error.message };
    tookDown = Boolean(rejected?.length);

    if (tookDown) {
      after(() => notifyEmployerOfModeration(parsed.data.jobId, false, parsed.data.note));
    }
  }

  const { data: resolved, error: resolveError } = await supabase
    .from('reports')
    .update({
      resolved: true,
      resolved_by: user?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('job_id', parsed.data.jobId)
    .eq('resolved', false)
    .select('id');

  if (resolveError) return { ok: false, error: resolveError.message };
  // Nothing open and nothing taken down means the queue moved on without this
  // reviewer — somebody else cleared it. Saying so beats a success message for
  // work that did not happen.
  if (!resolved?.length && !tookDown) return { ok: false, error: 'not_found' };

  revalidatePath('/admin/reports');
  revalidatePath('/admin/jobs');
  revalidatePath('/admin');
  if (tookDown) revalidatePath('/jobs');
  return { ok: true, data: { tookDown } };
}

/** Mints a short-lived signed URL for a verification document. */
export async function getDocumentUrl(documentId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data: document } = await supabase
    .from('company_documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle();

  if (!document) return { ok: false, error: 'not_found' };

  const { signedUrl, COMPANY_DOCS_BUCKET } = await import('@/lib/storage');
  const url = await signedUrl(COMPANY_DOCS_BUCKET, document.storage_path, 300);
  if (!url) return { ok: false, error: 'unavailable' };

  return { ok: true, data: { url } };
}

const approvalSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(['approved', 'pending', 'rejected']),
  note: z.string().trim().max(500).optional(),
});

/**
 * Approve, hold or suspend an account.
 *
 * Goes through set_account_approval rather than an UPDATE, because the rules
 * that make this safe — admin only, never an admin as the target, never
 * yourself — live in that function, and an UPDATE here would be a second place
 * to keep them. The guard trigger refuses the column to everyone else anyway;
 * this is the one door.
 */
export async function setAccountApproval(input: unknown): Promise<ActionResult> {
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { error } = await supabase.rpc('set_account_approval', {
    p_user: parsed.data.userId,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  // The in-app notification is written by a trigger, but somebody waiting to be
  // approved is not sitting in the console watching a bell. Pending accounts
  // are exactly the ones that need pushing to.
  if (parsed.data.status !== 'pending') {
    after(() =>
      notifyAccountDecision(
        parsed.data.userId,
        parsed.data.status === 'approved',
        parsed.data.note,
      ),
    );
  }

  revalidatePath('/admin/users');
  revalidatePath('/admin');
  // Suspension takes the account's live listings down with it when nobody
  // approved is left on the company, so the board and the jobs queue have both
  // changed by the time this returns.
  if (parsed.data.status === 'rejected') {
    revalidatePath('/jobs');
    revalidatePath('/admin/jobs');
  }
  return { ok: true };
}
