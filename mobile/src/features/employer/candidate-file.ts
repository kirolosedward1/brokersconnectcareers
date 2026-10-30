import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useRetryKey } from '~/lib/retry-key';
import { supabase } from '~/lib/supabase';

/**
 * What the company knows of each card's candidate (migration 375): notes
 * about the person, read on every application they send it, and the other
 * applications they sent it («تقدّم من قبل»). Two reads for the whole screen,
 * under row-level security; writes through the website.
 */

export type CandidateNote = { id: number; author_id: string | null; body: string; created_at: string };
export type EarlierApplication = {
  application_id: string;
  job_title_ar: string;
  job_title_en: string | null;
  status: ApplicationStatus;
  created_at: string;
};
export type CandidateFiles = {
  notes: Record<string, CandidateNote[]>;
  history: Record<string, EarlierApplication[]>;
  authors: Record<string, string>;
};

export function useCandidateFiles(applicationIds: string[]) {
  const key = [...applicationIds].sort();
  return useQuery({
    queryKey: ['employer', 'candidate-files', key.join(',')],
    enabled: key.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<CandidateFiles> => {
      const [notes, history] = await Promise.all([
        supabase.rpc('candidate_notes_for', { p_application_ids: key }),
        supabase.rpc('candidate_history_for', { p_application_ids: key }),
      ]);
      if (notes.error) throw notes.error;
      if (history.error) throw history.error;
      const files: CandidateFiles = { notes: {}, history: {}, authors: {} };
      for (const row of notes.data ?? []) (files.notes[row.for_application] ??= []).push(row);
      for (const row of history.data ?? []) (files.history[row.for_application] ??= []).push(row);
      const authorIds = [...new Set((notes.data ?? []).map((row) => row.author_id).filter((id): id is string => Boolean(id)))];
      if (authorIds.length) {
        // Allowed to fail quietly: a name missing reads as a former colleague.
        const { data: members } = await supabase.from('company_members').select('user_id, profile:profiles (full_name)').in('user_id', authorIds);
        for (const member of (members ?? []) as unknown as { user_id: string; profile: { full_name: string } | null }[]) {
          if (member.profile?.full_name) files.authors[member.user_id] = member.profile.full_name;
        }
      }
      return files;
    },
  });
}

export function useCandidateNoteActions() {
  const queryClient = useQueryClient();
  const retryKey = useRetryKey();
  const settle = () => queryClient.invalidateQueries({ queryKey: ['employer', 'candidate-files'] });
  const add = useMutation({
    mutationFn: async (input: { applicationId: string; body: string }) => {
      const result = await callAction('addCandidateNote', { ...input, idempotencyKey: retryKey.for(input) });
      if (!result.ok) throw new Error(result.error);
      retryKey.done();
    },
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      const result = await callAction('deleteCandidateNote', { id });
      if (!result.ok) throw new Error(result.error);
    },
    onSettled: settle,
  });
  return { add, remove };
}
