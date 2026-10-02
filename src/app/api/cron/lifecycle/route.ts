import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { cronAuthorised } from '@/lib/jobs/run';
import { logFailure } from '@/lib/observe';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The data lifecycle, the half that has to leave the database.
 *
 * run_lifecycle_maintenance() does everything a SQL statement can — expiry,
 * retention, finding files nothing points at — and pg_cron already runs it
 * hourly inside the database (migration 204). Calling it here too is
 * deliberate: it takes a non-blocking lock, so when both land together one of
 * them records "skipped" and returns, and if either scheduler is down the
 * other still runs it.
 *
 * What only this route can do is delete a stored file. Supabase refuses
 * deletes from storage.objects in SQL — the object has to go through the
 * Storage API so the bytes go with the row — so the database hands out a
 * leased batch (claim_storage_gc), this removes it, and reports back
 * (finish_storage_gc). Every file was re-checked for references at the moment
 * it was claimed, and every file had already waited out its grace period.
 *
 * Bounded: a fixed number of batches per run, a fixed batch size. A backlog
 * drains over several nights rather than in one long request.
 */

const BATCH = 100;
const MAX_BATCHES = 5;

export async function GET(request: NextRequest) {
  // The check every other cron route makes (runScheduledJob): this one
  // compared the raw header with `!==` — not in constant time — and took an
  // unedited REPLACE_ME from the import file as a secret.
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    console.error('[cron] lifecycle cannot run: SUPABASE_SERVICE_ROLE_KEY is not configured');
    return NextResponse.json({ error: 'unavailable', reason: 'service_role_missing' }, { status: 503 });
  }

  const { data: maintenance, error } = await admin.rpc('run_lifecycle_maintenance');
  if (error) {
    logFailure('lifecycle', 'maintenance failed', { code: error.code });
    // A code, never the database's words: they can quote a value.
    return NextResponse.json({ error: 'maintenance_failed', code: error.code ?? null }, { status: 500 });
  }

  // ------------------------------------------------------------ retention --
  // The privacy policy's periods (migration 338): applications a year after
  // they were sent, verification papers a year after verification ended, and
  // the logs. Before the file sweep, so what it releases is queued with the
  // rest. pg_cron runs the same function daily where the database has it; its
  // lock lets one of the two run. A database without it answers PGRST202,
  // which is not a failure.
  const { data: retention, error: retentionError } = await admin.rpc('run_privacy_retention', { p_limit: 500 });
  if (retentionError && retentionError.code !== 'PGRST202' && retentionError.code !== '42883') {
    logFailure('lifecycle', 'retention failed', { code: retentionError.code });
  }
  // A period it could not apply is reported in the answer, not raised, so the
  // others still run — which also means a part that fails every night (a
  // trigger change that makes its delete raise) looked like a clean run.
  // Which parts, never the database's words: those can quote a value.
  const retentionErrors = (retention as { errors?: unknown } | null)?.errors;
  if (Array.isArray(retentionErrors) && retentionErrors.length > 0) {
    logFailure('lifecycle', 'retention incomplete', {
      count: retentionErrors.length,
      parts: retentionErrors.map((entry) => String(entry).split(':')[0]).join(','),
    });
  }

  // ---------------------------------------------------------------- files --
  let removed = 0;
  let failed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data: claimed, error: claimError } = await admin.rpc('claim_storage_gc', { p_limit: BATCH });
    if (claimError) {
      logFailure('lifecycle', 'storage claim failed', { code: claimError.code });
      break;
    }
    if (!claimed?.length) break;

    const byBucket = new Map<string, string[]>();
    for (const row of claimed) {
      byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row.path]);
    }

    for (const [bucket, paths] of byBucket) {
      const { data: gone, error: removeError } = await admin.storage.from(bucket).remove(paths);

      if (removeError) {
        // The whole call failed: every path goes back with the error, keeps
        // its spent attempt, and is claimable again once the lease is lifted.
        failed += paths.length;
        logFailure('lifecycle', 'storage remove failed', { bucket, count: paths.length });
        await admin.rpc('finish_storage_gc', {
          p_bucket: bucket,
          p_removed: [],
          p_failed: paths,
          p_error: removeError.message.slice(0, 300),
        });
        continue;
      }

      /*
        The Storage API answers with the objects it deleted. A path missing
        from that list was already gone, which is the outcome asked for, so it
        counts as removed — claim_storage_gc only hands out paths it saw in
        storage.objects, and the next claim would close it as missing anyway.
      */
      removed += gone?.length ?? 0;
      await admin.rpc('finish_storage_gc', { p_bucket: bucket, p_removed: paths });
    }
  }

  // ------------------------------------------------- abandoned signups -----
  // Lists nothing until retention_policies.abandoned_signups is given a
  // period; see docs/data-lifecycle.md. Deleted through the Auth API so
  // GoTrue's own tables stay consistent.
  let signupsRemoved = 0;
  const { data: abandoned, error: abandonedError } = await admin.rpc('abandoned_signups', { p_limit: 50 });
  if (abandonedError) logFailure('lifecycle', 'abandoned signups not listed', { code: abandonedError.code });
  for (const row of abandoned ?? []) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(row.user_id);
    if (deleteError) logFailure('lifecycle', 'abandoned signup not removed', { user: row.user_id });
    else signupsRemoved += 1;
  }

  return NextResponse.json({
    maintenance,
    retention: retention ?? null,
    storage: { removed, failed },
    signups_removed: signupsRemoved,
    at: new Date().toISOString(),
  });
}
