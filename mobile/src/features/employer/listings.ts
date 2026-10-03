import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listingNotes, noteFor } from '@/lib/listing-notes';
import { canAccessEmployerArea } from '@/lib/permissions';
import type { JobRow } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The company's listings — the website's /employer/jobs console read, column
 * for column: only what the list draws, newest first, twenty-five at a time,
 * with the applicant count per listing and the exact total.
 */

export const LISTINGS_PAGE_SIZE = 25;

export type ConsoleListing = Pick<
  JobRow,
  | 'id'
  | 'slug'
  | 'title_ar'
  | 'title_en'
  | 'status'
  | 'seats'
  | 'view_count'
  | 'published_at'
  | 'expires_at'
  | 'created_at'
  | 'rejection_note'
> & {
  district: { name_ar: string; name_en: string } | null;
  applications: { count: number }[];
};

type ListingsPage = { listings: ConsoleListing[]; total: number };

export function useMyListings() {
  const { viewer, actor } = useSession();
  const companyId = canAccessEmployerArea(actor) ? (viewer?.company?.id ?? null) : null;

  return useInfiniteQuery({
    queryKey: ['employer', 'listings', companyId],
    enabled: Boolean(companyId),
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<ListingsPage> => {
      const from = (pageParam - 1) * LISTINGS_PAGE_SIZE;
      const { data, error, count } = await supabase
        .from('jobs')
        .select(
          `
          id, slug, title_ar, title_en, status, seats, view_count,
          published_at, expires_at, created_at, rejection_note,
          district:districts (name_ar, name_en),
          applications (count)
        `,
          { count: 'exact' },
        )
        .eq('company_id', companyId as string)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + LISTINGS_PAGE_SIZE - 1);
      // Past the end is the end, not an error (PostgREST refuses an unsatisfiable range).
      if (error?.code === 'PGRST103') return { listings: [], total: count ?? 0 };
      if (error) throw error;
      const rows = (data ?? []) as unknown as ConsoleListing[];
      // Why a listing was refused: beside it in job_moderation, the company's
      // to read (migration 347), or before that migration in its own column.
      const { notes, error: notesError } = await listingNotes(
        (ids) => supabase.from('job_moderation').select('job_id, rejection_note').in('job_id', ids),
        rows.map((row) => row.id),
      );
      if (notesError) throw notesError;
      return {
        listings: rows.map((row) => ({ ...row, rejection_note: noteFor(notes, row) })),
        total: count ?? data?.length ?? 0,
      };
    },
    getNextPageParam: (last, pages) =>
      pages.length * LISTINGS_PAGE_SIZE < last.total && last.listings.length > 0 ? pages.length + 1 : undefined,
  });
}

/** Every listing across the pages loaded so far, each once. */
export function flattenListings(pages: ListingsPage[] | undefined): ConsoleListing[] {
  const seen = new Set<string>();
  const listings: ConsoleListing[] = [];
  for (const page of pages ?? []) {
    for (const listing of page.listings) {
      if (seen.has(listing.id)) continue;
      seen.add(listing.id);
      listings.push(listing);
    }
  }
  return listings;
}

/** The refusals the website names, each with its own words; anything else is the generic line. */
export type TransitionRefusal = 'post_cap' | 'invalid_transition' | 'standing' | 'company_suspended' | 'failed';

export class TransitionRefused extends Error {
  constructor(readonly reason: TransitionRefusal) {
    super(reason);
    this.name = 'TransitionRefused';
  }
}

const NAMED: readonly TransitionRefusal[] = ['post_cap', 'invalid_transition', 'standing', 'company_suspended'];

/**
 * Close, submit or reopen a listing — the website's transitionJob, which only
 * makes the moves an employer may (publishing is a moderator's). Everything
 * the overview counts moves with it, so all of it is read again.
 */
export function useTransitionJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { jobId: string; status: 'draft' | 'pending_review' | 'closed' }) => {
      const result = await callAction('transitionJob', input);
      if (!result.ok) {
        throw new TransitionRefused((NAMED as readonly string[]).includes(result.error) ? (result.error as TransitionRefusal) : 'failed');
      }
    },
    // The listings are read again before the move counts as settled, so the
    // row shows its stored status; the overview's counts follow without holding the button.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['employer'], predicate: (query) => query.queryKey[1] !== 'listings' });
      void queryClient.invalidateQueries({ queryKey: ['jobs', 'detail'] });
      return queryClient.invalidateQueries({ queryKey: ['employer', 'listings'] });
    },
  });
}
