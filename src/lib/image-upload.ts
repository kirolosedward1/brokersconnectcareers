/**
 * Rules shared by the website and the phone for a profile photo or a company
 * logo, before either one is sent.
 *
 * The buckets take a PNG, JPEG or WebP of at most 2 MB. A HEIC from an iPhone
 * is none of those, and a camera original is often larger than the limit, so
 * both are settled here — named, measured and, on the website, redrawn —
 * rather than refused with a message about a CV.
 */
import { fileType, type NamedFile } from '@/lib/file-type';

/** The buckets' own limit (`file_size_limit` on avatars and company-logos). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Longest side the website will draw a photo to before it compresses it. */
export const AVATAR_MAX_EDGE = 1600;

/** Longest side the website will draw a logo to. A logo is shown larger than a photo. */
export const LOGO_MAX_EDGE = 2048;

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'heif', 'mif1', 'msf1']);

const RASTERS = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** What the file picker offers, including a HEIC the browser may only know by its suffix. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif';

/** A HEIF `ftyp` box: the brand sits at byte 8. JPEG and PNG never look like this. */
export function isHeicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const box = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  if (box !== 'ftyp') return false;
  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!).toLowerCase();
  return HEIC_BRANDS.has(brand);
}

/** A HEIC or HEIF the browser named, or named only by `.heic` / `.heif`. */
export function isHeicFile(file: NamedFile): boolean {
  const type = fileType(file);
  return type === 'image/heic' || type === 'image/heif';
}

/** A type the buckets already accept, so a small one can be sent as it is. */
export function isAllowedRaster(type: string): boolean {
  return RASTERS.has(type);
}

/**
 * Edges and JPEG/WebP qualities to try, largest and clearest first.
 *
 * The first edge is the longest side, capped by `maxEdge`. Each later edge is
 * three quarters of the one before it, and stops before the picture becomes a
 * thumbnail. Every edge is tried at each quality.
 */
export function compressionSteps(longestSide: number, maxEdge: number): { edge: number; quality: number }[] {
  const start = Math.max(1, Math.round(Math.min(Math.max(longestSide, 1), maxEdge)));
  const edges: number[] = [];
  let edge = start;
  while (edges.length < 6) {
    edges.push(edge);
    const next = Math.round(edge * 0.75);
    if (next >= edge || next < 256) break;
    edge = next;
  }
  const qualities = [0.92, 0.82, 0.7, 0.55, 0.4];
  return edges.flatMap((side) => qualities.map((quality) => ({ edge: side, quality })));
}

/**
 * A storage client's own sentence, safe to show and to log: one line, and
 * short. An empty message stays empty, and the caller keeps the generic
 * "try again" rather than a blank one.
 */
/**
 * The HEIC decoder's own limit. Past this the form stops waiting and says
 * the file type is not supported, instead of sitting there with no answer.
 */
export const HEIC_TIMEOUT_MS = 20_000;

/**
 * Resolves with `work`, or rejects once `ms` has passed.
 *
 * The timer is cleared when the work finishes, so a late success cannot
 * overturn a timeout that was already reported.
 */
export function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('failed'));
      },
    );
  });
}

export function storageDetail(message: string | null | undefined): string {
  return (message ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export type ImageFailureCopy = {
  imageType: string;
  imageTooLarge: string;
  uploadRateLimited: string;
  storageError: string;
  generic: string;
};

/**
 * The sentence for a photo or a logo that did not upload.
 *
 * `storage` keeps the storage client's own words after the catalogue sentence.
 * They are concatenated, not interpolated: a Postgres sentence can contain
 * braces, which a catalogue placeholder would try to fill.
 */
export function imageFailureCopy(error: string, detail: string | undefined, copy: ImageFailureCopy): string {
  if (error === 'file_type') return copy.imageType;
  if (error === 'too_large') return copy.imageTooLarge;
  if (error === 'rate_limited') return copy.uploadRateLimited;
  if (error === 'storage' && detail) return `${copy.storageError} ${detail}`;
  return copy.generic;
}
