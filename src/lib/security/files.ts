import 'server-only';
import sharp from 'sharp';
import { sniffKind, type FileKind } from '@/lib/security/magic';

export { sniffKind, isOwnedPath, CV_KINDS, IMAGE_KINDS, DOCUMENT_KINDS, type FileKind } from '@/lib/security/magic';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFailure } from '@/lib/observe';

export type StoredObjectVerdict =
  | { ok: true; kind: FileKind; bytes: number }
  | { ok: false; reason: 'missing' | 'wrong_kind' | 'too_large' | 'unavailable'; kind?: FileKind | null };

/** How many bytes each kind of upload may be. The bucket enforces the same. */
export const MAX_BYTES = {
  cv: 10 * 1024 * 1024,
  document: 10 * 1024 * 1024,
  image: 2 * 1024 * 1024,
} as const;

/**
 * Looks at an object the browser has already put in a bucket and says whether
 * it is what the caller expects. The head of the file through a short-lived
 * signed URL with a Range header, so a ten-megabyte CV costs a few kilobytes
 * to check; the size comes from the object's metadata.
 *
 * Called by the server action that records the path, before it records it.
 * A refusal removes the object, so nothing unrecognised stays in a bucket
 * under a name the platform once accepted.
 */
export async function verifyStoredObject(
  bucket: string,
  path: string,
  allowed: readonly FileKind[],
  maxBytes: number,
  /**
   * `keep`: a file rows already point at (cv-in-use.ts) is judged the same,
   * but never taken out — removing a refused file is right for one just
   * uploaded, and took a profile's CV out from under it.
   */
  { keep = false }: { keep?: boolean } = {},
): Promise<StoredObjectVerdict> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  const folder = path.split('/').slice(0, -1).join('/');
  const name = path.split('/').pop() ?? '';

  const { data: listed, error: listError } = await admin.storage
    .from(bucket)
    .list(folder, { search: name, limit: 100 });
  if (listError) {
    logFailure('upload', 'could not list an uploaded object', { bucket, code: listError.message });
    return { ok: false, reason: 'unavailable' };
  }
  const object = (listed ?? []).find((entry) => entry.name === name);
  if (!object) return { ok: false, reason: 'missing' };

  const size = Number((object.metadata as { size?: number } | null)?.size ?? 0);
  if (size > maxBytes) {
    if (!keep) await admin.storage.from(bucket).remove([path]);
    return { ok: false, reason: 'too_large' };
  }

  const { data: signed, error: signError } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 60);
  if (signError || !signed?.signedUrl) return { ok: false, reason: 'unavailable' };

  let head: Uint8Array;
  try {
    const response = await fetch(signed.signedUrl, {
      headers: { range: 'bytes=0-4095' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    head = new Uint8Array(await response.arrayBuffer()).slice(0, 4096);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  const kind = sniffKind(head);
  if (!kind || !allowed.includes(kind)) {
    if (!keep) await admin.storage.from(bucket).remove([path]);
    return { ok: false, reason: 'wrong_kind', kind };
  }

  return { ok: true, kind, bytes: size };
}

/**
 * An uploaded image, decoded and written out again.
 *
 * Decoding proves it is an image the decoder understands; re-encoding leaves
 * behind everything that was not pixels — EXIF (which carries the GPS
 * position a phone photographed from), embedded profiles, trailing data, and
 * whatever a crafted file hid past the image data. The output is a WebP of
 * bounded dimensions, which is also what every place these are drawn wants.
 */
export async function reencodeImage(
  input: ArrayBuffer | Uint8Array,
  { maxSide = 1024 }: { maxSide?: number } = {},
): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  try {
    const source = sharp(Buffer.from(input as ArrayBuffer), {
      // A decompression bomb is a small file with an enormous canvas; refuse
      // anything past what a profile photo could honestly need.
      limitInputPixels: 40_000_000,
      failOn: 'error',
    });
    const meta = await source.metadata();
    if (!meta.width || !meta.height) return null;

    const image = await source
      .rotate() // honour orientation once, then drop the tag with the rest
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return { bytes: image.data, width: image.info.width, height: image.info.height };
  } catch {
    return null;
  }
}
