import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIST_SELECT, type JobListItem } from '@/lib/job-list';
import { canSaveJobs } from '@/lib/permissions';
import { followQuery } from '@/lib/saved-search';
import type { SavedSearchRow } from '@/lib/supabase/database.types';
import { callAction, refusedAtTheDoor } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * What a candidate keeps: bookmarked listings, saved searches, and followed
 * companies — which underneath are saved searches with one filter, so the
 * weekly digest, its switch and the cap of ten are shared. Read straight from
 * Supabase under row-level security, scoped to the candidate explicitly as
 * the website's pages do; every change runs the website's action.
 *
 * Changes show at once and are put back if the server says no: a bookmark
 * that waits on a round trip reads as broken, and undoing one costs a tap.
 */

/** A candidate's id when this person keeps bookmarks at all (canSaveJobs), else null. */
function useCandidateId(): string | null {
  const { session, actor } = useSession();
  return canSaveJobs(actor) ? (session?.user.id ?? null) : null;
}

const idsKey = (candidateId: string | null) => ['saved', 'jobIds', candidateId] as const;
const searchesKey = (candidateId: string | null) => ['saved', 'searches', candidateId] as const;

/**
 * Every listing this candidate has bookmarked, as ids — what a card's bookmark
 * reads. One small read for the whole app rather than one per screen, so a
 * bookmark set on the board is already set on the listing and in Saved.
 * `known` is false until they have been read: the website's action is a
 * toggle, so a bookmark pressed before then could take one off.
 */
export function useSavedJobIds(): { ids: Set<string>; known: boolean } {
  const candidateId = useCandidateId();
  const { data } = useQuery({
    queryKey: idsKey(candidateId),
    enabled: Boolean(candidateId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('saved_jobs')
        .select('job_id')
        .eq('candidate_id', candidateId as string);
      if (error) throw error;
      return (rows ?? []).map((row) => row.job_id as string);
    },
  });
  // Nobody to read them for (signed out): nothing is saved, and that is known.
  return { ids: new Set(data ?? []), known: !candidateId || data !== undefined };
}

/**
 * The bookmarked listings, newest bookmark first — the website's
 * /dashboard/saved read. The same set as the ids above, so it answers them
 * too: the cards in the list never draw as unsaved while those are read.
 */
export function useSavedJobs() {
  const queryClient = useQueryClient();
  const candidateId = useCandidateId();
  return useQuery({
    queryKey: ['saved', 'jobs', candidateId],
    enabled: Boolean(candidateId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_jobs')
        .select(`created_at, job:jobs!inner (${LIST_SELECT})`)
        .eq('candidate_id', candidateId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const jobs = ((data ?? []) as unknown as { job: JobListItem | null }[])
        .map((row) => row.job)
        .filter((job): job is JobListItem => Boolean(job));
      // Fresher than any earlier read of the ids: a bookmark removed on the
      // website is gone here too.
      queryClient.setQueryData<string[]>(
        idsKey(candidateId),
        jobs.map((job) => job.id),
      );
      return jobs;
    },
  });
}

/** Whether the listing is bookmarked now, as the database says; null when that cannot be read. */
async function savedNow(candidateId: string, jobId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('saved_jobs')
    .select('job_id')
    .eq('candidate_id', candidateId)
    .eq('job_id', jobId)
    .limit(1);
  return error ? null : Boolean(data?.length);
}

/** Bookmark a listing, or take the bookmark off — the website's toggleSavedJob. */
export function useToggleSavedJob() {
  const queryClient = useQueryClient();
  const candidateId = useCandidateId();
  const key = idsKey(candidateId);

  const set = (jobId: string, saved: boolean) =>
    queryClient.setQueryData<string[]>(key, (ids = []) =>
      saved ? (ids.includes(jobId) ? ids : [...ids, jobId]) : ids.filter((id) => id !== jobId),
    );

  return useMutation({
    mutationFn: async ({ jobId, saved }: { jobId: string; saved: boolean }) => {
      const result = await callAction('toggleSavedJob', { jobId }).catch(async (error: unknown) => {
        // No answer: the bookmark may have changed. The website's action is a
        // toggle, so the same tap sent again would put it back; the database
        // says where it stands, and a change that went in is the answer.
        if (!refusedAtTheDoor(error) && candidateId && (await savedNow(candidateId, jobId)) === !saved) {
          return { ok: true as const, data: { saved: !saved } };
        }
        throw error;
      });
      if (!result.ok || !result.data) throw new Error(result.ok ? 'failed' : result.error);
      return result.data.saved;
    },
    onMutate: async ({ jobId, saved }) => {
      await queryClient.cancelQueries({ queryKey: key });
      set(jobId, !saved);
    },
    // The server's answer is the truth: it toggles what it has, not what the screen showed.
    onSuccess: (saved, { jobId }) => set(jobId, saved),
    onError: (_error, { jobId, saved }) => set(jobId, saved),
    onSettled: (_saved, error) => {
      // Home counts what is saved (candidate_summary).
      void queryClient.invalidateQueries({ queryKey: ['candidate'] });
      // Not known how it ended: the bookmarks are read again rather than guessed.
      if (error) void queryClient.invalidateQueries({ queryKey: key });
      return queryClient.invalidateQueries({ queryKey: ['saved', 'jobs'] });
    },
  });
}

/** Saved searches and follows, newest first. */
export function useSavedSearches() {
  const candidateId = useCandidateId();
  return useQuery({
    queryKey: searchesKey(candidateId),
    enabled: Boolean(candidateId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_searches')
        .select('*')
        .eq('candidate_id', candidateId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SavedSearchRow[];
    },
  });
}

/** Rewrite the cached list, and hand back how to put it back. */
function useSearchesCache() {
  const queryClient = useQueryClient();
  const key = searchesKey(useCandidateId());
  return {
    key,
    queryClient,
    async edit(change: (rows: SavedSearchRow[]) => SavedSearchRow[]) {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<SavedSearchRow[]>(key);
      queryClient.setQueryData<SavedSearchRow[]>(key, (rows) => (rows ? change(rows) : rows));
      return () => queryClient.setQueryData(key, before);
    },
  };
}

/** The weekly email for one search or follow, on or off. */
export function useSetSearchAlerts() {
  const cache = useSearchesCache();
  return useMutation({
    mutationFn: async ({ id, alerts }: { id: string; alerts: boolean }) => {
      const result = await callAction('setSearchAlerts', { id, alerts });
      if (!result.ok) throw new Error(result.error);
    },
    onMutate: ({ id, alerts }) => cache.edit((rows) => rows.map((row) => (row.id === id ? { ...row, alerts } : row))),
    onError: (_error, _input, restore) => restore?.(),
    // Home counts the alerts that are on (candidate_summary).
    onSettled: () => void cache.queryClient.invalidateQueries({ queryKey: ['candidate'] }),
  });
}

/** Delete a saved search, or stop following a company — the same row either way. */
export function useDeleteSavedSearch() {
  const cache = useSearchesCache();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const result = await callAction('deleteSavedSearch', { id });
      if (!result.ok) throw new Error(result.error);
    },
    onMutate: ({ id }) => cache.edit((rows) => rows.filter((row) => row.id !== id)),
    onError: (_error, _input, restore) => restore?.(),
    onSettled: () => {
      void cache.queryClient.invalidateQueries({ queryKey: ['candidate'] });
      return cache.queryClient.invalidateQueries({ queryKey: cache.key });
    },
  });
}

/** Why a save or follow was refused, as the website's forms say it. */
export type SaveRefusal = 'already_saved' | 'cap' | 'no_filters' | 'failed';

export class SaveRefused extends Error {
  constructor(readonly reason: SaveRefusal) {
    super(reason);
    this.name = 'SaveRefused';
  }
}

function refusal(error: string): SaveRefusal {
  return error === 'already_saved' || error === 'cap' || error === 'no_filters' ? error : 'failed';
}

/** "Tell me when there's a new one of these": the board's filters, named. */
export function useSaveSearch() {
  const cache = useSearchesCache();
  return useMutation({
    mutationFn: async (input: { label: string; query: string }) => {
      const result = await callAction('saveSearch', input);
      if (!result.ok) throw new SaveRefused(refusal(result.error));
    },
    onSettled: () => {
      void cache.queryClient.invalidateQueries({ queryKey: ['candidate'] });
      return cache.queryClient.invalidateQueries({ queryKey: cache.key });
    },
  });
}

/** Whether this candidate follows the company, from the saved searches already read. */
export function useFollowing(slug: string): { following: boolean; known: boolean } {
  const searches = useSavedSearches();
  const query = followQuery(slug);
  return {
    following: Boolean(searches.data?.some((row) => row.query === query)),
    known: searches.isSuccess,
  };
}

/** Follow a company (a saved search with only its filter), or stop. */
export function useToggleFollow(slug: string, label: string) {
  const cache = useSearchesCache();
  const query = followQuery(slug);

  return useMutation({
    mutationFn: async ({ follow }: { follow: boolean }) => {
      const result = follow
        ? await callAction('followCompany', { slug, label })
        : await callAction('unfollowCompany', { slug });
      if (!result.ok) throw new SaveRefused(refusal(result.error));
    },
    onMutate: ({ follow }) =>
      cache.edit((rows) =>
        follow
          ? [
              // A stand-in until the list is read again.
              {
                id: `pending-${slug}`,
                candidate_id: '',
                label,
                query,
                alerts: true,
                created_at: new Date().toISOString(),
                last_sent_at: null,
                last_checked_at: null,
                bell_checked_at: null,
              },
              ...rows,
            ]
          : rows.filter((row) => row.query !== query),
      ),
    onError: (_error, _input, restore) => restore?.(),
    onSettled: () => {
      void cache.queryClient.invalidateQueries({ queryKey: ['candidate'] });
      return cache.queryClient.invalidateQueries({ queryKey: cache.key });
    },
  });
}
