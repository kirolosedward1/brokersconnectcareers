import { canSaveJobs } from '@/lib/permissions';
import { useSession } from '~/lib/session';

/** A candidate's id when this person keeps bookmarks at all (canSaveJobs), else null. */
export function useCandidateId(): string | null {
  const { session, actor } = useSession();
  return canSaveJobs(actor) ? (session?.user.id ?? null) : null;
}
