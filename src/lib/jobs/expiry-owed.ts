import 'server-only';
import type { createAdminClient } from '@/lib/supabase/admin';
import { jobExpiryKeyPrefix } from '@/lib/email/notify';
import { logFailure } from '@/lib/observe';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The listings in `jobs` whose notice for this stage some member is still
 * owed, in the same order, at most `cap` of them (the nightly expiry run,
 * src/app/api/cron/expire-jobs).
 *
 * Each member of the company gets their own copy, keyed
 * `<prefix><memberId>` (notify.ts, jobExpiryKeyPrefix). A listing is told
 * once every member who takes these emails (notify_status) holds their key.
 * Counted as told when any one member did, a member whose copy never reached
 * the outbox — a read that failed on the way, which leaves no row for the
 * sweeper to retry — was passed over every night after, and so was a member
 * who joined since. A member with the emails off is not waited for: nothing
 * would ever be claimed for them.
 *
 * A lookup that fails is not a reason to skip anybody: that chunk is kept,
 * and the claim decides.
 */
export async function stillOwed(
  admin: Admin,
  jobs: readonly { id: string; company_id: string; expires_at: string | null }[],
  stage: 'expiring' | 'expired',
  { cap, chunk: size }: { cap: number; chunk: number },
): Promise<{ id: string }[]> {
  const template = stage === 'expiring' ? 'job_expiring' : 'job_expired';
  const owed: { id: string }[] = [];
  for (let i = 0; i < jobs.length && owed.length < cap; i += size) {
    const chunk = jobs.slice(i, i + size);
    const [sent, members] = await Promise.all([
      admin
        .from('email_log')
        .select('dedupe_key')
        .eq('template', template)
        .in('entity_id', chunk.map((job) => job.id)),
      admin
        .from('company_members')
        .select('company_id, user_id')
        .in('company_id', [...new Set(chunk.map((job) => job.company_id))]),
    ]);
    if (sent.error) {
      logFailure('cron', 'could not check which expiry notices went', { stage, code: sent.error.code });
    }
    const keys = new Set((sent.data ?? []).map((row) => row.dedupe_key ?? ''));

    // Who of them takes the emails. Unknown is "yes": the claim and the
    // preference check in notify.ts decide.
    let silent = new Set<string>();
    const memberIds = [...new Set((members.data ?? []).map((row) => row.user_id))];
    if (memberIds.length) {
      const { data: profiles, error: profilesError } = await admin
        .from('profiles')
        .select('id, notify_status')
        .in('id', memberIds);
      if (profilesError) {
        logFailure('cron', 'could not read who takes expiry notices', { stage, code: profilesError.code });
      }
      silent = new Set((profiles ?? []).filter((row) => row.notify_status === false).map((row) => row.id));
    }

    for (const job of chunk) {
      if (owed.length >= cap) break;
      const prefix = jobExpiryKeyPrefix(stage, job.id, job.expires_at);
      if (members.error) {
        // Who the members are is unknown: any copy sent counts, as it always did.
        if (![...keys].some((key) => key.startsWith(prefix))) owed.push({ id: job.id });
        continue;
      }
      const waiting = (members.data ?? []).filter(
        (row) => row.company_id === job.company_id && !silent.has(row.user_id) && !keys.has(`${prefix}${row.user_id}`),
      );
      if (waiting.length) owed.push({ id: job.id });
    }
  }
  return owed;
}
