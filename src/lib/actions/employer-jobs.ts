'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from '@/lib/auth';
import { buildJobSlug } from '@/lib/slug';
import { withUniqueSlug } from '@/lib/actions/unique-slug';
import { getDistricts } from '@/lib/queries/taxonomy';
import {
  BENEFITS,
  COMMISSION_TYPES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
} from '@/lib/taxonomy';
import { salaryReference } from '@/lib/queries/jobs';
import type { ActionResult } from '@/lib/actions/jobs';
import type { SalaryReferenceRow } from '@/lib/supabase/database.types';
import { after } from 'next/server';
import { notifyJobSubmitted } from '@/lib/email/notify';
import { logFailure } from '@/lib/observe';

const jobSchema = z
  .object({
    id: z.string().uuid().optional(),
    titleAr: z.string().trim().min(3).max(160),
    titleEn: z.string().trim().max(160).optional().nullable(),
    track: z.enum(JOB_TRACKS),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    experienceBand: z.enum(EXPERIENCE_BANDS),
    seats: z.coerce.number().int().min(1).max(999),
    districtId: z.coerce.number().int().positive(),
    basicSalaryMin: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
    basicSalaryMax: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
    commissionType: z.enum(COMMISSION_TYPES),
    commissionValue: z.coerce.number().min(0).max(100).nullable().optional(),
    commissionNoteAr: z.string().trim().max(500).optional().nullable(),
    leadsSource: z.enum(LEADS_SOURCES),
    benefits: z.array(z.enum(BENEFITS)).max(5),
    descriptionAr: z.string().trim().min(20).max(8000),
    descriptionEn: z.string().trim().max(8000).optional().nullable(),
    requirementsAr: z.string().trim().max(4000).optional().nullable(),
    developerIds: z.array(z.coerce.number().int().positive()).max(30),
    /** The version the form was built from; absent when creating. */
    version: z.coerce.number().int().positive().optional(),
    /**
     * Made once by the wizard and repeated on every retry, so a request that
     * timed out after the server committed converges on the listing it already
     * made rather than posting a second one.
     */
    idempotencyKey: z.string().uuid().optional(),
    submit: z.boolean(),
  })
  .refine(
    (value) =>
      value.basicSalaryMin == null ||
      value.basicSalaryMax == null ||
      value.basicSalaryMax >= value.basicSalaryMin,
    { path: ['basicSalaryMax'], message: 'salaryOrder' },
  )
  .refine(
    (value) => value.commissionType !== 'percentage' || value.commissionValue != null,
    { path: ['commissionValue'], message: 'commissionRequired' },
  );

/**
 * Creates or updates a listing. An employer can save a draft or submit for
 * review; publishing is a moderation action and is refused at the database
 * level for anyone who is not an admin.
 */
export async function saveJob(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message || 'required';
    }
    return { ok: false, error: 'invalid', fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  /*
    Membership. jobs_insert_owner checks owns_company(), which reads
    company_members — so the database was happy to let a recruiter post and
    this lookup was the only thing refusing them, with 'no_company' on a
    screen that had just shown them the company's other listings.
  */
  const { data: companyId } = await supabase.rpc('my_company_id');
  const { data: company } = companyId
    ? await supabase.from('companies').select('id, name_ar, name_en').eq('id', companyId).maybeSingle()
    : { data: null };

  if (!company) return { ok: false, error: 'no_company' };

  const value = parsed.data;

  /*
    What editing a live listing does to its status, which is: nothing here.

    This wrote `pending_review` or `draft` on every save, including a save of a
    listing already on the board — and guard_job_update permits neither from
    `active`, so every edit of a live advert failed outright. The button was on
    the screen, the form loaded with the listing in it, and the save came back
    "something went wrong". Proven against production: the update raises "job
    status cannot go from active to pending_review".

    The database already has the rule this wanted. When a live listing's pay,
    title, description, seats, leads or commission change, guard_job_update
    moves it back to pending_review itself; when nothing material changed it
    stays up. So an edit of an active listing sends no status at all and lets
    the guard decide, which is also the only way a typo fix can avoid costing
    the employer a day off the board.
  */
  const { data: current } = value.id
    ? await supabase.from('jobs').select('status, version').eq('id', value.id).maybeSingle()
    : { data: null };

  const live = current?.status === 'active';
  const status = value.submit ? 'pending_review' : 'draft';

  const payload = {
    title_ar: value.titleAr,
    title_en: value.titleEn || null,
    track: value.track,
    employment_type: value.employmentType,
    experience_band: value.experienceBand,
    seats: value.seats,
    district_id: value.districtId,
    basic_salary_min: value.basicSalaryMin ?? null,
    basic_salary_max: value.basicSalaryMax ?? null,
    commission_type: value.commissionType,
    // The database rejects a value on any type other than percentage, so drop
    // whatever a stale form field left behind.
    commission_value: value.commissionType === 'percentage' ? (value.commissionValue ?? null) : null,
    commission_note_ar: value.commissionNoteAr || null,
    leads_source: value.leadsSource,
    benefits: value.benefits,
    description_ar: value.descriptionAr,
    description_en: value.descriptionEn || null,
    requirements_ar: value.requirementsAr || null,
  } as const;

  let jobId = value.id;

  if (jobId) {
    // .select() so a listing the caller does not belong to is a refusal rather
    // than a save that quietly changed nothing. RLS filtering an update to zero
    // rows produces no error.
    /*
      Compare and swap, not last-write-wins.

      A company is a team, and every admin may edit every listing on it — so
      two people on the same advert is what inviting a colleague produces, not
      a contrived case. The second save used to win silently and the first
      simply ceased to exist; on a live listing it is the second saver's copy
      that then goes back to the moderation queue, so what returns to the board
      is what nobody meant to send.

      Matching on the version the form was built from makes the update itself
      the check — one statement, no window between reading and writing. Zero
      rows then means one of two things, and `current` says which: the listing
      moved under them, or it was never theirs to edit.
    */
    const query = supabase
      .from('jobs')
      .update(live ? payload : { ...payload, status })
      .eq('id', jobId);

    const { data: saved, error } = await (
      value.version ? query.eq('version', value.version) : query
    ).select('id');

    if (error) {
      logFailure('listing', 'save refused', { job: jobId, company: company.id, code: error.code });
      return { ok: false, error: mapJobError(error.message) };
    }

    if (!saved?.length) {
      logFailure('listing', current ? 'save lost the race' : 'save refused', {
        job: jobId,
        company: company.id,
        version: value.version,
      });
      return { ok: false, error: current ? 'stale' : 'forbidden' };
    }
  } else {
    const districts = await getDistricts();
    const district = districts.find((d) => d.id === value.districtId);

    const { data, error } = await withUniqueSlug<{ id: string }>(
      () => buildJobSlug(value.titleEn || value.titleAr, district?.slug ?? 'egypt'),
      (slug) =>
        supabase
          .from('jobs')
          .insert({
            company_id: company.id,
            slug,
            status,
            idempotency_key: value.idempotencyKey ?? null,
            ...payload,
          })
          .select('id')
          .single(),
    );

    if (error || !data) {
      /*
        The same request, arriving twice.

        A client that times out after the server committed sends the form
        again, and without the key the second request is indistinguishable from
        a deliberate second advert: same company, same title, two listings, two
        credits, and the applicants split between them. With it, the second
        insert collides on jobs_idempotency_key_idx and the listing the first
        one made is the answer — which is what the employer meant both times.
      */
      const collided = error?.code === '23505' && value.idempotencyKey;

      if (collided) {
        const { data: already } = await supabase
          .from('jobs')
          .select('id')
          .eq('company_id', company.id)
          .eq('idempotency_key', value.idempotencyKey!)
          .maybeSingle();

        if (already) return { ok: true, data: { id: already.id } };
      }

      return { ok: false, error: mapJobError(error?.message ?? 'insert_failed') };
    }

    jobId = data.id;
  }

  /*
    The developer tags, changed by difference rather than replaced.

    This deleted every row and inserted the new set, with neither result
    checked. PostgREST has no transaction spanning two calls, so a failed
    insert left the listing with no developers at all and the screen saying it
    had saved — on a listing that may already be in front of a moderator.
    Deleting only what was removed and inserting only what was added means a
    failure changes nothing it was not asked to change.
  */
  const { data: taggedRows } = await supabase
    .from('job_developers')
    .select('developer_id')
    .eq('job_id', jobId!);

  const tagged = new Set((taggedRows ?? []).map((row) => row.developer_id));
  const wanted = new Set(value.developerIds);
  const dropped = [...tagged].filter((id) => !wanted.has(id));
  const added = [...wanted].filter((id) => !tagged.has(id));

  if (dropped.length) {
    const { error } = await supabase
      .from('job_developers')
      .delete()
      .eq('job_id', jobId!)
      .in('developer_id', dropped);
    if (error) return { ok: false, error: error.message };
  }

  if (added.length) {
    const { error } = await supabase
      .from('job_developers')
      .insert(added.map((developerId) => ({ job_id: jobId!, developer_id: developerId })));
    if (error) return { ok: false, error: error.message };
  }

  /*
    Only when it actually entered the queue. Saving a draft is not an event
    anybody needs an email about, and re-saving a listing already in review is
    deduplicated on the job id rather than sending a second receipt.

    Read back rather than assumed, because a live listing's status is now the
    guard's decision and not this function's: a material edit puts it in the
    queue and a cosmetic one leaves it on the board, and only the row knows
    which happened.
  */
  const { data: settled } = await supabase
    .from('jobs')
    .select('status')
    .eq('id', jobId!)
    .maybeSingle();

  if (settled?.status === 'pending_review' && current?.status !== 'pending_review') {
    const submitted = jobId!;
    after(() => notifyJobSubmitted(submitted));
  }

  revalidatePath('/employer/jobs');
  return { ok: true, data: { id: jobId! } };
}

const transitionSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['draft', 'pending_review', 'closed']),
});

/**
 * The transitions an employer is allowed to make. `active` is deliberately not
 * on this list — guard_job_update() in the database refuses it regardless.
 */
export async function transitionJob(input: unknown): Promise<ActionResult> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const supabase = await createClient();
  const { data: moved, error } = await supabase
    .from('jobs')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.jobId)
    .select('id');

  if (error) {
    logFailure('listing', 'transition refused', {
      job: parsed.data.jobId,
      to: parsed.data.status,
      code: error.code,
    });
    return { ok: false, error: mapJobError(error.message) };
  }

  // Closing a listing that is not yours reported success and closed nothing.
  if (!moved?.length) {
    logFailure('listing', 'transition changed nothing', {
      job: parsed.data.jobId,
      to: parsed.data.status,
    });
    return { ok: false, error: 'forbidden' };
  }

  revalidatePath('/employer/jobs');
  return { ok: true };
}

/** Turns database-level rule violations into something the UI can explain. */
function mapJobError(message: string): string {
  if (message.includes('unverified_company_post_cap')) return 'post_cap';
  if (message.includes('job status cannot go from')) return 'invalid_transition';
  return message;
}


/**
 * Whether this company already has a listing that is, to a reader, this one.
 *
 * Nothing stopped a brokerage posting "Property Consultant – New Cairo" three
 * times to fill three seats, which the seats field already models. Each copy
 * costs a credit and splits the applicants three ways. This is a warning at
 * the wizard's first step, never a block: legitimate near-duplicates exist,
 * and the employer, not the form, knows which this is.
 *
 * Scoped to the caller's own company explicitly. RLS lets everyone read
 * active listings, so without the company filter this would match a
 * competitor's advert and tell an employer they had posted something they had
 * not. Titles compare after the same normalisation a reader's eye performs —
 * diacritics, tatweel, alef and ya variants, spacing — so "استشاري" and
 * "إستشاري" are one title.
 */
const similarSchema = z.object({
  titleAr: z.string().trim().min(1).max(160),
  districtId: z.coerce.number().int().positive(),
  excludeId: z.string().uuid().optional().nullable(),
});

function normaliseTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export async function findSimilarListing(
  input: unknown,
): Promise<ActionResult<{ match: { id: string; title: string; seats: number } | null }>> {
  const none = { ok: true as const, data: { match: null } };
  const parsed = similarSchema.safeParse(input);
  if (!parsed.success) return none;

  const viewer = await getViewer();
  if (!viewer?.company) return none;

  const supabase = await createClient();
  const { data } = await supabase
    .from('jobs')
    .select('id, title_ar, seats')
    .eq('company_id', viewer.company.id)
    .eq('district_id', parsed.data.districtId)
    .in('status', ['active', 'pending_review', 'draft']);

  const wanted = normaliseTitle(parsed.data.titleAr);
  const match = (data ?? []).find(
    (row) => row.id !== parsed.data.excludeId && normaliseTitle(row.title_ar) === wanted,
  );

  return {
    ok: true,
    data: { match: match ? { id: match.id, title: match.title_ar, seats: match.seats } : null },
  };
}

const referenceSchema = z.object({
  track: z.enum(JOB_TRACKS),
  districtId: z.coerce.number().int().positive(),
});

/**
 * What listings like this one are paying, for the employer writing one.
 *
 * The wizard asks on leaving the first step and renders on the second, exactly
 * as the duplicate-listing warning does — so the round trip happens while
 * somebody is reading the compensation fields rather than waiting to reach
 * them. And like that warning it is never enforced: an employer is free to pay
 * whatever they pay, and the number is here so the decision is informed rather
 * than blind.
 *
 * A null answer is the common one and needs no explanation in the interface.
 * The database refuses to summarise fewer than five live listings, so there is
 * nothing to hedge — either the board knows, or the step looks exactly as it
 * did before this existed.
 */
export async function salaryReferenceFor(
  input: unknown,
): Promise<ActionResult<{ reference: SalaryReferenceRow | null }>> {
  const none = { ok: true as const, data: { reference: null } };
  const parsed = referenceSchema.safeParse(input);
  if (!parsed.success) return none;

  const districts = await getDistricts();
  const district = districts.find((row) => row.id === parsed.data.districtId);
  if (!district) return none;

  return {
    ok: true,
    data: { reference: await salaryReference(parsed.data.track, district.governorate_id) },
  };
}
