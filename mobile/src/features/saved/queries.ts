import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIST_SELECT, type JobListItem } from '@/lib/job-list';
import { followQuery } from '@/lib/saved-search';
import type { SavedSearchRow } from '@/lib/supabase/database.types';
import { callAction, refusedAtTheDoor } from '~/lib/api';
import { supabase } from '~/lib/supabase';
import { useCandidateId } from './candidate';
import { holdNote, restoreNote } from './notes';
import { cancelReminder, restoreReminder } from './reminders';
import { savedOffline } from '~/features/saved/offline';

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

const marksKey = (candidateId: string | null) => ['saved', 'marks', candidateId] as const;
const searchesKey = (candidateId: string | null) => ['saved', 'searches', candidateId] as const;

/**
 * A bookmark as the app holds it everywhere: which listing, the candidate's
 * note on it (saved_jobs.note, migration 356) and when to remind them before
 * it closes (saved_jobs.remind_at, migration 366) — the same row the website's
 * saved page reads, so both show the same note and a new phone finds it there.
 */
export type SavedMark = { job_id: string; note: string | null; remind_at: string | null };
const MARKS_SELECT = 'job_id, note, remind_at';

/**
 * Every bookmark this candidate holds — what a card's bookmark, a note and a
 * reminder read. One small read for the whole app rather than one per
 * screen, so a bookmark set on the board is already set on the listing and in
 * Saved. `known` is false until it has been read: the website's action is a
 * toggle, so a bookmark pressed before then could take one off. `readAt` is
 * when (0 before).
 */
export function useSavedMarks(): { marks: readonly SavedMark[]; known: boolean; readAt: number } {
  const candidateId = useCandidateId();
  const { data, dataUpdatedAt } = useQuery({
    queryKey: marksKey(candidateId),
    enabled: Boolean(candidateId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('saved_jobs')
        .select(MARKS_SELECT)
        .eq('candidate_id', candidateId as string);
      if (error) throw error;
      return (rows ?? []) as SavedMark[];
    },
  });
  // Nobody to read them for (signed out): nothing is saved, and that is known.
  return { marks: data ?? NONE, known: !candidateId || data !== undefined, readAt: data ? dataUpdatedAt : 0 };
}

const NONE: readonly SavedMark[] = [];

/** Every listing this candidate has bookmarked, as ids. */
export function useSavedJobIds(): { ids: Set<string>; known: boolean } {
  const { marks, known } = useSavedMarks();
  const ids = useMemo(() => new Set(marks.map((mark) => mark.job_id)), [marks]);
  return { ids, known };
}

/** This candidate's bookmark of a listing, while it is saved. */
export function useSavedMark(jobId: string): SavedMark | null {
  return useSavedMarks().marks.find((mark) => mark.job_id === jobId) ?? null;
}

/**
 * Changes one bookmark as held, at once, and hands back how to put it back —
 * for a note or a reminder shown before the website has answered.
 */
export function useEditSavedMark() {
  const queryClient = useQueryClient();
  const candidateId = useCandidateId();
  return useCallback(
    (jobId: string, change: Partial<Omit<SavedMark, 'job_id'>>) => {
      const key = marksKey(candidateId);
      const before = queryClient.getQueryData<SavedMark[]>(key)?.find((mark) => mark.job_id === jobId);
      const put = (next: Partial<Omit<SavedMark, 'job_id'>>) =>
        queryClient.setQueryData<SavedMark[]>(key, (marks) => marks?.map((mark) => (mark.job_id === jobId ? { ...mark, ...next } : mark)));
      put(change);
      return () => {
        if (before) put({ note: before.note, remind_at: before.remind_at });
      };
    },
    [queryClient, candidateId],
  );
}

/** Read the bookmarks again — after a reminder set or taken back outside a mutation. */
export function useRefreshSavedMarks() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: ['saved', 'marks'] }), [queryClient]);
}

/**
 * The bookmarked listings, newest bookmark first — the website's
 * /dashboard/saved read. The same set as the marks above, so it answers them
 * too: the cards in the list never draw as unsaved while those are read.
 */
export function useSavedJobs({ active = true }: { active?: boolean } = {}) {
  const queryClient = useQueryClient();
  const candidateId = useCandidateId();
  return useQuery({
    queryKey: ['saved', 'jobs', candidateId],
    enabled: Boolean(candidateId) && active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_jobs')
        .select(`created_at, note, remind_at, job:jobs!inner (${LIST_SELECT})`)
        .eq('candidate_id', candidateId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as unknown as { note: string | null; remind_at: string | null; job: JobListItem | null }[]).filter(
        (row): row is { note: string | null; remind_at: string | null; job: JobListItem } => Boolean(row.job),
      );
      // Fresher than any earlier read of the marks: a bookmark removed, or a
      // note written, on the website is so here too.
      queryClient.setQueryData<SavedMark[]>(
        marksKey(candidateId),
        rows.map((row) => ({ job_id: row.job.id, note: row.note ?? null, remind_at: row.remind_at ?? null })),
      );
      const jobs = rows.map((row) => row.job);
      // For the next time there is no connection (features/saved/offline.ts).
      if (candidateId) savedOffline.replace(candidateId, jobs);
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
  const key = marksKey(candidateId);

  // A bookmark put back starts bare; its note and reminder, if it had them, follow (restoreNote, restoreReminder).
  const set = (jobId: string, saved: boolean) =>
    queryClient.setQueryData<SavedMark[]>(key, (marks = []) =>
      saved
        ? marks.some((mark) => mark.job_id === jobId)
          ? marks
          : [...marks, { job_id: jobId, note: null, remind_at: null }]
        : marks.filter((mark) => mark.job_id !== jobId),
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
      // What the bookmark carried, for an Undo that puts it back.
      const before = queryClient.getQueryData<SavedMark[]>(key)?.find((mark) => mark.job_id === jobId);
      set(jobId, !saved);
      return { before };
    },
    // The server's answer is the truth: it toggles what it has, not what the screen showed.
    onSuccess: async (saved, { jobId }, context) => {
      set(jobId, saved);
      if (!candidateId) return;
      // The note and the reminder go with the row; held a while, so an Undo that
      // puts the bookmark back puts them back too.
      if (!saved) {
        holdNote(candidateId, jobId, context?.before?.note ?? null);
        void cancelReminder(candidateId, jobId, { withBookmark: true });
        return;
      }
      const note = await restoreNote(candidateId, jobId);
      if (note) queryClient.setQueryData<SavedMark[]>(key, (marks) => marks?.map((mark) => (mark.job_id === jobId ? { ...mark, note } : mark)));
      if (await restoreReminder(candidateId, jobId)) void queryClient.invalidateQueries({ queryKey: key });
    },
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
