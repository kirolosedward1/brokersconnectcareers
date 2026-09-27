/**
 * Puts Storage objects from a storage-backup.mjs copy back into a project,
 * then checks every one by hash.
 *
 *   TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/dr/storage-restore.mjs <backup-dir> [--only <bucket>/<prefix>]
 *
 * Never overwrites. An object that already exists in the target is left alone
 * and reported if its bytes differ from the backup, so this is safe to point at
 * production to bring back files that were deleted: it only fills gaps. Doing
 * that is still refused unless DR_ALLOW_PRODUCTION is set to the production
 * project ref.
 *
 * Buckets must already exist (the migrations create them). A restored object
 * gets a new id and no owner; nothing in this schema depends on either — every
 * policy and every column refers to objects by path.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROD_REF = 'hiwdhicwsohbipxzazmb';
const dir = process.argv[2];
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : null;
const url = process.env.TARGET_SUPABASE_URL;
const key = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
if (!dir || !url || !key) {
  console.error('Usage: TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... node scripts/dr/storage-restore.mjs <dir>');
  process.exit(2);
}
if (url.includes(PROD_REF) && process.env.DR_ALLOW_PRODUCTION !== PROD_REF) {
  console.error(`Target is PRODUCTION (${PROD_REF}). Refusing.`);
  console.error(`This script never overwrites, but set DR_ALLOW_PRODUCTION=${PROD_REF} to confirm.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const supabase = createClient(url, key, { auth: { persistSession: false } });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const { data: buckets, error } = await supabase.storage.listBuckets();
if (error) throw new Error(`listBuckets: ${error.message}`);
const present = new Set(buckets.map((b) => b.id));
const missingBuckets = manifest.buckets.filter((b) => !present.has(b.id)).map((b) => b.id);
if (missingBuckets.length) {
  console.error(`Target lacks bucket(s) ${missingBuckets.join(', ')}. Run the migrations first.`);
  process.exit(1);
}

const objects = manifest.objects.filter((o) => !only || `${o.bucket}/${o.path}`.startsWith(only));
let restored = 0;
let alreadyThere = 0;
const conflicts = [];
const failed = [];

for (const o of objects) {
  const buf = readFileSync(join(dir, o.bucket, o.path));
  if (sha256(buf) !== o.sha256) {
    failed.push(`${o.bucket}/${o.path} (backup copy is corrupt)`);
    continue;
  }
  const { error: upError } = await supabase.storage
    .from(o.bucket)
    .upload(o.path, buf, { contentType: o.contentType ?? undefined, upsert: false });

  if (upError && /exists|duplicate/i.test(upError.message)) {
    alreadyThere += 1;
  } else if (upError) {
    failed.push(`${o.bucket}/${o.path}: ${upError.message}`);
    continue;
  } else {
    restored += 1;
  }

  // Whatever is there now must be the backup's bytes.
  const { data: blob, error: dlError } = await supabase.storage.from(o.bucket).download(o.path);
  if (dlError) failed.push(`${o.bucket}/${o.path}: read-back ${dlError.message}`);
  else if (sha256(Buffer.from(await blob.arrayBuffer())) !== o.sha256) conflicts.push(`${o.bucket}/${o.path}`);
}

console.log(`${objects.length} object(s): ${restored} restored, ${alreadyThere} already present`);
if (conflicts.length) console.log(`\nDIFFERENT from backup (left as is, review by hand):\n  ${conflicts.join('\n  ')}`);
if (failed.length) console.log(`\nFAILED:\n  ${failed.join('\n  ')}`);
process.exit(failed.length ? 1 : 0);
