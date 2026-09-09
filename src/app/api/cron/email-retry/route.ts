import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { REBUILDERS } from '@/lib/email/rebuild';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The retry sweeper.
 *
 * A message that failed inside an after() callback has nowhere to be retried
 * from — the request is over. This is where it gets picked up: the outbox row
 * is the queue, and pending_emails() is the query that reads it.
 *
 * Deliberately not a real queue product. This platform already runs Vercel
 * Cron and already has Postgres, and a message that goes out four hours late
 * is a message that went out — introducing a broker, a worker and a second
 * deployment target to save those hours would be the wrong trade for a
 * job board. What matters is that nothing is silently lost, and the outbox is
 * what guarantees that.
 *
 * Bounded three ways, because an unbounded retry loop against a paid provider
 * is worse than a lost email: three attempts per message (pending_emails),
 * a batch cap per run, and a three-day window after which a row is left alone
 * for good.
 *
 * Rows younger than five minutes are skipped: they are probably mid-send in an
 * after() callback right now, and re-sending one would defeat the claim.
 */

const BATCH = 25;

export async function GET(request: NextRequest) {
  const secret = env.cronSecret;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const { data: pending, error } = await admin.rpc('pending_emails', { p_limit: BATCH });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let retried = 0;
  let sent = 0;
  let abandoned = 0;

  for (const row of pending ?? []) {
    const rebuild = REBUILDERS[row.template];

    // Nothing to rebuild from — a digest, or a message whose entity is gone.
    // Spend the budget so the sweeper stops looking at it every hour.
    if (!rebuild || !row.entity_id) {
      await admin.rpc('record_email_attempt', {
        p_id: row.id,
        p_status: 'failed',
        p_error: 'not retryable',
        p_exhaust: true,
      });
      abandoned += 1;
      continue;
    }

    // The rebuilder claims a *new* row under the same dedupe key, which the
    // unique index refuses — so the old row is released first. Releasing means
    // clearing its key, not deleting it: the failed attempt stays on the
    // record, which is the whole point of an outbox.
    await admin.rpc('release_email_claim', { p_id: row.id });

    retried += 1;
    if ((await rebuild(row.entity_id)) === 'sent') sent += 1;
  }

  return NextResponse.json({ retried, sent, abandoned, at: new Date().toISOString() });
}
