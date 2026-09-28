'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { publish } from '@/lib/notifications/events';
import { notifyJobChanged } from '@/lib/seo/indexing-api';
import { adminErrorCode } from '@/lib/admin/errors';

/**
 * The console's levers.
 *
 * Every mutation here is one call to an admin_* function (migration 318), made
 * through the caller's own session — never the service role. That function is
 * where the rules live: it refuses anybody who is not an admin, locks the row,
 * refuses a transition the product does not have, requires a reason where
 * somebody is owed one, and writes the audit record in the same transaction as
 * the change. So a success returned from here means the change and its record
 * are both committed, and there is no path through this file that can report
 * success for a write that did not persist.
 *
 * assertAdmin() still runs first. It is not the lock — the database is — but it
 * turns a stray call into a cheap refusal before any work, and it is the check
 * for the one read here (the signed document URL) that is not a function call.
 *
 * Decisions somebody is waiting on are published after the response, as the
 * same business events the rest of the product sends (lib/notifications).
 * Search engines are told after the response too, whenever a lever changes
 * whether a listing is public.
 */
type AdminResult<T = undefined> = ActionResult<T>;

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

const reason = z.string().trim().max(500).optional();

/** Every admin page reads through the console layout, so one call covers them. */
function refreshConsole() {
  revalidatePath('/admin', 'layout');
}

type Client = NonNullable<Awaited<ReturnType<typeof assertAdmin>>>;

/**
 * The live listings a suspension could take down, read before it happens.
 *
 * Compared afterwards by announceTakedowns(), so only the listings that actually
 * went to `rejected` are reported to Google: a company with somebody else still
 * in good standing keeps trading, and its listings must not be announced as
 * gone. Allowed to fail quietly — it only decides what Google is told.
 */
async function liveListings(supabase: Client, companyIds: string[]) {
  if (!companyIds.length) return [];
  const { data } = await supabase
    .from('jobs')
    .select('id, slug')
    .in('company_id', companyIds)
    .eq('status', 'active');
  return (data ?? []) as { id: string; slug: string }[];
}

// Taken down means gone from the public site: row-level security hides a
// rejected listing and its URL now answers 404, which is what Google is told.
function announceTakedowns(supabase: Client, exposed: { id: string }[]) {
  if (!exposed.length) return;
  const ids = exposed.map((row) => row.id);
  after(async () => {
    const { data } = await supabase.from('jobs').select('slug').in('id', ids).eq('status', 'rejected');
    for (const row of data ?? []) await notifyJobChanged(row.slug, 'URL_DELETED');
  });
}

/** One listing's slug, for telling Google about a decision on it. */
function announceListing(supabase: Client, jobId: string, type: 'URL_UPDATED' | 'URL_DELETED') {
  after(async () => {
    const { data } = await supabase.from('jobs').select('slug').eq('id', jobId).maybeSingle();
    await notifyJobChanged(data?.slug, type);
  });
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

const JOB_ACTIONS = ['approve', 'reject', 'request_changes', 'unpublish', 'close', 'restore'] as const;
export type JobModerationAction = (typeof JOB_ACTIONS)[number];

const moderateSchema = z.object({
  jobId: z.string().uuid(),
  action: z.enum(JOB_ACTIONS),
  reason,
});

export async function moderateJob(input: unknown): Promise<AdminResult> {
  const parsed = moderateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { jobId, action } = parsed.data;
  const note = parsed.data.reason || null;

  const { error } = await supabase.rpc('admin_moderate_job', {
    p_job: jobId,
    p_action: action,
    p_reason: note,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  // The employer has been waiting on this decision. Closing on their behalf
  // is not a verdict on the listing, so it sends nothing.
  if (action === 'approve' || action === 'restore') {
    after(() => publish({ type: 'JOB_APPROVED', jobId }));
  } else if (action !== 'close') {
    after(() => publish({ type: 'JOB_REJECTED', jobId, note }));
  }

  // Google hears about the listings whose public page changed: live now
  // (approve, restore), closed (still a page, now noindex) or taken down
  // (unpublish). A rejection from review was never public and is not news.
  if (action === 'approve' || action === 'restore' || action === 'close') {
    announceListing(supabase, jobId, 'URL_UPDATED');
  } else if (action === 'unpublish') {
    announceListing(supabase, jobId, 'URL_DELETED');
  }

  refreshConsole();
  revalidatePath('/jobs');
  return { ok: true };
}

const featureSchema = z.object({ jobId: z.string().uuid(), featured: z.boolean() });

export async function setJobFeatured(input: unknown): Promise<AdminResult> {
  const parsed = featureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { error } = await supabase.rpc('admin_set_job_featured', {
    p_job: parsed.data.jobId,
    p_featured: parsed.data.featured,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  refreshConsole();
  revalidatePath('/jobs');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const reviewSchema = z.object({
  companyId: z.string().uuid(),
  decision: z.enum(['verify', 'reject', 'request_changes', 'revoke']),
  note: reason,
});

export async function reviewCompany(input: unknown): Promise<AdminResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { companyId, decision } = parsed.data;
  const note = parsed.data.note || null;

  const { error } = await supabase.rpc('admin_review_company', {
    p_company: companyId,
    p_decision: decision,
    p_note: note,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  // A company waiting on its review has no other way to hear the outcome. A
  // request for changes is told the same way as a rejection — with the note,
  // which is the part they act on.
  if (decision === 'verify') {
    after(() => publish({ type: 'COMPANY_VERIFIED', companyId }));
  } else if (decision !== 'revoke') {
    after(() => publish({ type: 'COMPANY_VERIFICATION_REJECTED', companyId, note }));
  }

  refreshConsole();
  revalidatePath('/companies');
  return { ok: true };
}

const suspensionSchema = z.object({
  companyId: z.string().uuid(),
  suspend: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

export async function setCompanySuspension(input: unknown): Promise<AdminResult<{ takenDown: number }>> {
  const parsed = suspensionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'reason_required' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const exposed = parsed.data.suspend ? await liveListings(supabase, [parsed.data.companyId]) : [];

  const { data, error } = await supabase.rpc('admin_set_company_suspension', {
    p_company: parsed.data.companyId,
    p_suspend: parsed.data.suspend,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  announceTakedowns(supabase, exposed);
  refreshConsole();
  revalidatePath('/jobs');
  revalidatePath('/companies');
  return { ok: true, data: { takenDown: Number(data ?? 0) } };
}

/** Mints a five-minute signed URL for a verification document, on the record. */
export async function getDocumentUrl(documentId: string): Promise<AdminResult<{ url: string }>> {
  if (!z.string().uuid().safeParse(documentId).success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data: path, error } = await supabase.rpc('admin_open_document', { p_document: documentId });
  if (error) return { ok: false, error: adminErrorCode(error) };
  if (!path) return { ok: false, error: 'not_found' };

  const { signedUrl, COMPANY_DOCS_BUCKET } = await import('@/lib/storage');
  const url = await signedUrl(COMPANY_DOCS_BUCKET, path, 300);
  if (!url) return { ok: false, error: 'unavailable' };

  return { ok: true, data: { url } };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const approvalSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(['approved', 'pending', 'rejected']),
  note: reason,
});

/**
 * Approve, hold, suspend or restore an account.
 *
 * Goes through set_account_approval, where the rules that make this safe
 * live: admin only, never an admin as the target, never yourself, a reason for
 * a suspension, no repeat of a decision already made, and the record of it.
 */
export async function setAccountApproval(input: unknown): Promise<AdminResult> {
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  // A suspension can take down the listings of every company this person
  // belongs to (when nobody approved is left on it).
  let exposed: { id: string; slug: string }[] = [];
  if (parsed.data.status === 'rejected') {
    const { data: memberships } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', parsed.data.userId);
    exposed = await liveListings(supabase, (memberships ?? []).map((row) => row.company_id));
  }

  const { error } = await supabase.rpc('set_account_approval', {
    p_user: parsed.data.userId,
    p_status: parsed.data.status,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  if (parsed.data.status !== 'pending') {
    const { userId, note } = parsed.data;
    after(() =>
      publish(
        parsed.data.status === 'approved'
          ? { type: 'ACCOUNT_APPROVED', userId }
          : { type: 'ACCOUNT_SUSPENDED', userId, note },
      ),
    );
  }

  announceTakedowns(supabase, exposed);
  refreshConsole();
  // Suspension takes the account's live listings down with it when nobody
  // approved is left on the company.
  if (parsed.data.status === 'rejected') revalidatePath('/jobs');
  return { ok: true };
}

const revealSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

/**
 * One account's email and phone, for an admin who says why.
 *
 * Nothing else in the console returns either. The request is recorded with
 * its reason before the details come back, in the same transaction.
 */
export async function revealContact(
  input: unknown,
): Promise<AdminResult<{ email: string | null; phone: string }>> {
  const parsed = revealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'reason_required' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data, error } = await supabase.rpc('admin_reveal_contact', {
    p_user: parsed.data.userId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  const row = data?.[0];
  if (!row) return { ok: false, error: 'not_found' };

  refreshConsole();
  return { ok: true, data: { email: row.email, phone: row.whatsapp_phone } };
}

// ---------------------------------------------------------------------------
// Consultants
// ---------------------------------------------------------------------------

const restrictionSchema = z.object({
  agentId: z.string().uuid(),
  restrict: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

export async function setAgentRestriction(input: unknown): Promise<AdminResult> {
  const parsed = restrictionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'reason_required' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { error } = await supabase.rpc('admin_set_agent_restriction', {
    p_agent: parsed.data.agentId,
    p_restrict: parsed.data.restrict,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  refreshConsole();
  revalidatePath('/agents');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const reportsSchema = z.object({
  targetType: z.enum(['job', 'company', 'agent']),
  targetId: z.string().uuid(),
  status: z.enum(['investigating', 'resolved', 'dismissed']),
  note: reason,
  takeAction: z.boolean().default(false),
});

/**
 * Move every open report on one target together, optionally taking the
 * matching action — listing down, company suspended, consultant restricted —
 * in the same transaction as the resolution.
 */
export async function moderateReports(input: unknown): Promise<AdminResult<{ moved: number }>> {
  const parsed = reportsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { targetType, targetId, status, takeAction } = parsed.data;
  const note = parsed.data.note || null;

  // Acting on a company suspends it, which takes its live listings down.
  const exposed = takeAction && targetType === 'company' ? await liveListings(supabase, [targetId]) : [];

  const { data, error } = await supabase.rpc('admin_moderate_reports', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_status: status,
    p_note: note,
    p_take_action: takeAction,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  const outcome = data as { reports: number; took_action: boolean } | null;
  if (outcome?.took_action && targetType === 'job') {
    after(() => publish({ type: 'JOB_REJECTED', jobId: targetId, note }));
    announceListing(supabase, targetId, 'URL_DELETED');
  }
  if (outcome?.took_action) announceTakedowns(supabase, exposed);

  refreshConsole();
  if (outcome?.took_action) {
    revalidatePath('/jobs');
    revalidatePath('/companies');
    revalidatePath('/agents');
  }
  return { ok: true, data: { moved: outcome?.reports ?? 0 } };
}

// ---------------------------------------------------------------------------
// Internal notes
// ---------------------------------------------------------------------------

const noteSchema = z.object({
  targetType: z.enum(['user', 'company', 'job', 'agent', 'application', 'report']),
  targetId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(2000),
});

export async function addModerationNote(input: unknown): Promise<AdminResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { error } = await supabase.rpc('admin_add_note', {
    p_target_type: parsed.data.targetType,
    p_target_id: parsed.data.targetId,
    p_body: parsed.data.body,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  refreshConsole();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

const taxonomySchema = z.object({
  kind: z.enum(['district', 'governorate', 'developer']),
  id: z.number().int().positive().nullable(),
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(60).optional(),
  governorateId: z.number().int().positive().nullable().optional(),
});

export async function saveTaxonomy(input: unknown): Promise<AdminResult<{ id: number }>> {
  const parsed = taxonomySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_name' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { data, error } = await supabase.rpc('admin_save_taxonomy', {
    p_kind: parsed.data.kind,
    p_id: parsed.data.id,
    p_name_ar: parsed.data.nameAr,
    p_name_en: parsed.data.nameEn,
    p_slug: parsed.data.slug || null,
    p_governorate_id: parsed.data.governorateId ?? null,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  // Districts, governorates and developers are cached for a day across the
  // whole site; a rename that waited a day to appear would look like a bug.
  revalidateTag('taxonomy');
  refreshConsole();
  return { ok: true, data: { id: Number(data) } };
}

const deleteTaxonomySchema = z.object({
  kind: z.enum(['district', 'governorate', 'developer']),
  id: z.number().int().positive(),
});

export async function deleteTaxonomy(input: unknown): Promise<AdminResult> {
  const parsed = deleteTaxonomySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await assertAdmin();
  if (!supabase) return { ok: false, error: 'forbidden' };

  const { error } = await supabase.rpc('admin_delete_taxonomy', {
    p_kind: parsed.data.kind,
    p_id: parsed.data.id,
  });
  if (error) return { ok: false, error: adminErrorCode(error) };

  revalidateTag('taxonomy');
  refreshConsole();
  return { ok: true };
}
