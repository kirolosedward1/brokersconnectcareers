import { useQuery } from '@tanstack/react-query';
import { isAdmin } from '@/lib/permissions';
import type { AdminAuditRow, AuditTargetType, ModerationNoteRow } from '@/lib/supabase/database.types';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';
import { useAdminDoor } from './door';

/**
 * The record of one thing in the console — a listing, a company, a
 * consultant's profile, an application, an account: the decisions the admins
 * took on it (admin_audit_log) and the notes they left each other
 * (moderation_notes), fifty each, newest first. Read as the admin, under the
 * same policies the website's pages read them, and only through the open door.
 */

/** An admin whose door is open: the one condition every console read waits for. */
export function useOpen(): boolean {
  const { actor } = useSession();
  const door = useAdminDoor();
  return isAdmin(actor) && door.state === 'open';
}

export type RecordRows = { audit: AdminAuditRow[]; notes: ModerationNoteRow[] };

export function useRecord(targetType: AuditTargetType, targetId: string | undefined) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'record', targetType, targetId],
    enabled: open && Boolean(targetId),
    queryFn: async (): Promise<RecordRows> => {
      const id = targetId as string;
      const [audit, notes] = await Promise.all([
        supabase
          .from('admin_audit_log')
          .select('*')
          .eq('target_type', targetType)
          .eq('target_id', id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('moderation_notes')
          .select('*')
          .eq('target_type', targetType)
          .eq('target_id', id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (audit.error) throw audit.error;
      if (notes.error) throw notes.error;
      return { audit: (audit.data ?? []) as AdminAuditRow[], notes: (notes.data ?? []) as ModerationNoteRow[] };
    },
  });
}
