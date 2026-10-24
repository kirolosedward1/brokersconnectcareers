'use client';

/**
 * Turn a chosen photo or logo into a file the upload action can accept.
 *
 * A PNG, JPEG or WebP that is already within 2 MB is sent unchanged. Anything
 * larger is drawn smaller and compressed until it fits. A HEIC or HEIF — what
 * an iPhone saves — is converted to JPEG first (libheif in the browser, and
 * the browser's own decoder when that cannot). The server still decodes the
 * result and stores a WebP; this only gets a picture across the limit the
 * bucket and the action both enforce before that decode.
 *
 * Loaded by the two upload forms only. `heic2any` is imported when the file
 * is actually a HEIC, so the rest of the site does not carry the decoder.
 */
import {
  AVATAR_MAX_EDGE,
  IMAGE_ACCEPT,
  isAllowedRaster,
  isHeicBytes,
  isHeicFile,
  LOGO_MAX_EDGE,
  MAX_IMAGE_BYTES,
  compressionSteps,
} from '@/lib/image-upload';
import { fileType } from '@/lib/file-type';

export { IMAGE_ACCEPT };

export type PreparedUpload = { ok: true; file: File } | { ok: false; error: 'too_large' | 'file_type' };

type Kind = 'avatar' | 'logo';

export async function prepareUploadImage(file: File, kind: Kind): Promise<PreparedUpload> {
  if (file.size === 0) return { ok: false, error: 'too_large' };
  if (isSvg(file)) return { ok: false, error: 'file_type' };

  if (await isHeic(file)) {
    const jpeg = await heicToJpeg(file);
    const source = jpeg ?? file;
    if (jpeg && jpeg.size <= MAX_IMAGE_BYTES) return { ok: true, file: jpeg };
    return compress(source, kind, jpeg?.name ?? renamed(file.name, 'jpg'), 'image/jpeg');
  }

  const type = fileType(file);
  if (!isAllowedRaster(type)) return { ok: false, error: 'file_type' };
  if (file.size <= MAX_IMAGE_BYTES) return { ok: true, file };
  return compress(file, kind, file.name, type === 'image/jpeg' ? 'image/jpeg' : 'image/webp');
}

function isSvg(file: File): boolean {
  return file.type.toLowerCase() === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
}

async function isHeic(file: File): Promise<boolean> {
  if (isHeicFile(file)) return true;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return isHeicBytes(head);
}

async function heicToJpeg(file: File): Promise<File | null> {
  try {
    const { default: convert } = await import('heic2any');
    const converted = await convert({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob || blob.size === 0) return null;
    return new File([blob], renamed(file.name, 'jpg'), { type: 'image/jpeg' });
  } catch {
    // Safari decodes a HEIC itself. The canvas path below uses that.
    return null;
  }
}

async function compress(source: Blob, kind: Kind, name: string, preferred: 'image/jpeg' | 'image/webp'): Promise<PreparedUpload> {
  if (typeof document === 'undefined') return { ok: false, error: 'file_type' };
  const bitmap = await decode(source);
  if (!bitmap) return { ok: false, error: 'file_type' };

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const maxEdge = kind === 'avatar' ? AVATAR_MAX_EDGE : LOGO_MAX_EDGE;
    for (const step of compressionSteps(longest, maxEdge)) {
      const encoded = await encode(bitmap, step.edge, step.quality, preferred);
      const fitted = encoded && encoded.size > 0 && encoded.size <= MAX_IMAGE_BYTES ? encoded : null;
      const blob =
        fitted ??
        (preferred === 'image/webp' ? await encode(bitmap, step.edge, step.quality, 'image/jpeg') : null);
      if (!blob || blob.size === 0 || blob.size > MAX_IMAGE_BYTES) continue;
      const type = blob.type === 'image/png' || blob.type === 'image/webp' || blob.type === 'image/jpeg' ? blob.type : preferred;
      const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      return { ok: true, file: new File([blob], renamed(name, extension), { type }) };
    }
    return { ok: false, error: 'too_large' };
  } finally {
    bitmap.close();
  }
}

async function decode(source: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(source);
    } catch {
      return null;
    }
  }
}

function encode(bitmap: ImageBitmap, edge: number, quality: number, mime: 'image/jpeg' | 'image/webp'): Promise<Blob | null> {
  const longest = Math.max(bitmap.width, bitmap.height, 1);
  const scale = Math.min(1, edge / longest);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  if (mime === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), mime, quality);
  });
}

function renamed(name: string, extension: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim() || 'image';
  return `${base}.${extension}`;
}
