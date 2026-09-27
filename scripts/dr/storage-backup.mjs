/**
 * Copies every Storage object out of a Supabase project, with a manifest.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/dr/storage-backup.mjs <output-dir>
 *
 * Database backups (Supabase's or ours) hold only the metadata row for each
 * file. The bytes of CVs, logos, profile photos and verification documents live
 * in Storage and are gone for good once deleted — Storage keeps no versions and
 * no trash. This script is the only copy that survives that.
 *
 * The output directory is required and belongs outside the repository, which
 * lives under an iCloud-synced folder.
 *
 * Writes <output-dir>/<bucket>/<path> for every object, and manifest.json
 * listing bucket, path, size, content type and sha256 for each. Existing files
 * with a matching hash are skipped, so re-running into the same directory is an
 * incremental copy.
 *
 * CVs and verification documents are personal data. Encrypt the directory
 * before it leaves the machine, e.g.
 *   tar -C <output-dir> -c . | age -r "$AGE_RECIPIENT" > storage-<ts>.tar.age
 *
 * Read-only against the project.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/dr/storage-backup.mjs <output-dir> (outside the repository)');
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every object under a prefix. Storage lists one level at a time. */
async function listAll(bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders come back with a null id.
      if (entry.id === null) files.push(...(await listAll(bucket, path)));
      else files.push({ path, size: entry.metadata?.size ?? null, contentType: entry.metadata?.mimetype ?? null });
    }
    if (data.length < 1000) break;
  }
  return files;
}

mkdirSync(out, { recursive: true, mode: 0o700 });
const { data: buckets, error } = await supabase.storage.listBuckets();
if (error) throw new Error(`listBuckets: ${error.message}`);

const manifest = { source: url, takenAt: new Date().toISOString(), buckets: [], objects: [] };
let copied = 0;
let skipped = 0;

for (const bucket of buckets) {
  manifest.buckets.push({
    id: bucket.id,
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit,
    allowedMimeTypes: bucket.allowed_mime_types,
  });
  const files = await listAll(bucket.id);
  console.log(`${bucket.id}: ${files.length} object(s)`);

  for (const file of files) {
    const local = join(out, bucket.id, file.path);
    const { data: blob, error: dlError } = await supabase.storage.from(bucket.id).download(file.path);
    if (dlError) throw new Error(`download ${bucket.id}/${file.path}: ${dlError.message}`);
    const buf = Buffer.from(await blob.arrayBuffer());
    const hash = sha256(buf);
    if (existsSync(local) && sha256(readFileSync(local)) === hash) {
      skipped += 1;
    } else {
      mkdirSync(dirname(local), { recursive: true, mode: 0o700 });
      writeFileSync(local, buf, { mode: 0o600 });
      copied += 1;
    }
    manifest.objects.push({ bucket: bucket.id, ...file, size: buf.length, sha256: hash });
  }
}

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(`\n${manifest.objects.length} object(s): ${copied} copied, ${skipped} unchanged → ${out}`);
