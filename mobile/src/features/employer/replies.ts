import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canAccessEmployerArea } from '@/lib/permissions';
import type { SavedReplyRow } from '@/lib/supabase/database.types';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The company's saved replies (migration 374): the team's, and the person's
 * own, read under row-level security; written through the website, which
 * checks their words. Whether this person may write the team's (an admin)
 * comes with them, for the sheet to offer it or not.
 */

export class ReplyRefused extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: string,
  ) {
    super(reason);
    this.name = 'ReplyRefused';
  }
}

export type Replies = { team: SavedReplyRow[]; own: SavedReplyRow[]; isAdmin: boolean };

export function useReplies(enabled = true) {
  const { session, viewer, actor } = useSession();
  const userId = canAccessEmployerArea(actor) ? (session?.user.id ?? null) : null;
  const companyId = viewer?.company?.id ?? null;
  return useQuery({
    queryKey: ['employer', 'replies', userId, companyId],
    enabled: enabled && Boolean(userId && companyId),
    queryFn: async (): Promise<Replies> => {
      const [replies, membership] = await Promise.all([
        supabase.from('saved_replies').select('*').order('created_at', { ascending: true }).limit(200),
        supabase.from('company_members').select('role').eq('company_id', companyId as string).eq('user_id', userId as string).maybeSingle(),
      ]);
      if (replies.error) throw replies.error;
      const rows = (replies.data ?? []) as SavedReplyRow[];
      return {
        team: rows.filter((row) => row.person_id === null),
        own: rows.filter((row) => row.person_id !== null),
        isAdmin: (membership.data as { role?: string } | null)?.role === 'admin',
      };
    },
  });
}

export function useReplyActions() {
  const queryClient = useQueryClient();
  const settle = () => queryClient.invalidateQueries({ queryKey: ['employer', 'replies'] });
  const save = useMutation({
    mutationFn: async (input: { body: string; channel: 'whatsapp' | 'email'; teamWide: boolean; title?: string | null }) => {
      const result = await callAction('saveReply', input);
      if (!result.ok) throw new ReplyRefused(result.error, result.fieldErrors?.body);
      return result.data?.reply ?? null;
    },
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const result = await callAction('deleteReply', { id });
      if (!result.ok) throw new ReplyRefused(result.error);
    },
    onSettled: settle,
  });
  return { save, remove };
}
