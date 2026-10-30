import type { JobListItem } from '@/lib/job-list';
import { createLocalList } from '~/lib/local-list';

/**
 * The saved listings as they were last read, kept on this phone for the
 * person who saved them (src/lib/local-list.ts: per account, gone with the
 * account) — so Saved still shows them with no connection (v1.1), said to be
 * as they were then. Written on every read that answers; read only when one
 * does not.
 */
export const savedOffline = createLocalList<JobListItem>('bc.saved-offline.v1', {
  max: 100,
  idOf: (job) => job.id,
  valid: (item): item is JobListItem =>
    typeof (item as JobListItem | null)?.id === 'string' && typeof (item as JobListItem | null)?.slug === 'string',
});
