'use client';

/**
 * Turn a chosen photo or logo into a file the upload action can accept.
 *
 * A PNG, JPEG or WebP that is already within 2 MB is sent unchanged. Anything
 * larger is drawn smaller and compressed until it fits. A HEIC or HEIF that
 * still arrives — the picker does not offer it, so an iPhone's Safari has
 * usually already turned it into JPEG — is decoded to a JPEG of the primary
 * frame, at that frame's own size, before any of this scaling. The server
 * still decodes the result and stores a WebP; this only gets a picture across
 * the limit the bucket and the action both enforce before that decode.
 *
 * Loaded by the two upload forms only. The decoder is a worker imported when
 * the file is actually a HEIC, so the rest of the site does not carry it.
 */
import {
  AVATAR_MAX_EDGE,
  HEIC_TIMEOUT_MS,
  IMAGE_ACCEPT,
  deadline,
  isAllowedRaster,
  isHeicBytes,
  isHeicFile,
  LOGO_MAX_EDGE,
  MAX_IMAGE_BYTES,
  compressionSteps,
} from '@/lib/image-upload';
import { fileType } from '@/lib/file-type';

export { IMAGE_ACCEPT };

export type PreparedUpload = { ok: true; file: File } | { ok: false; error: 'too_large' | 'file_type' | 'unreadable' };

type Kind = 'avatar' | 'logo';

export async function prepareUploadImage(file: File, kind: Kind): Promise<PreparedUpload> {
  if (file.size === 0) return { ok: false, error: 'too_large' };
  if (isSvg(file)) return { ok: false, error: 'file_type' };

  if (await isHeic(file)) {
    try {
      const jpeg = await deadline(heicToJpeg(file), HEIC_TIMEOUT_MS);
      if (jpeg.size <= MAX_IMAGE_BYTES) return { ok: true, file: jpeg };
      return await compress(jpeg, kind, jpeg.name, 'image/jpeg');
    } catch {
      // The worker was refused, the decoder never answered, or the file is
      // not a picture. The form says it could not be read and clears the
      // picker; it does not keep waiting.
      return { ok: false, error: 'unreadable' };
    }
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

type HeicWorkerResponse = { width: number; height: number; pixels: ArrayBuffer; error?: undefined } | { error: string; pixels?: undefined };

async function heicToJpeg(file: File): Promise<File> {
  try {
    const image = await decodeHeic(file);
    // A result this small is the embedded preview. A browser that can decode
    // the file itself may still have the full frame; use that when it is
    // plainly the larger picture. Otherwise keep what libheif returned.
    if (image.width * image.height < 1024 * 1024) {
      const bitmap = await decode(file);
      if (bitmap && bitmap.width * bitmap.height > image.width * image.height * 4) {
        try {
          const blob = await encode(bitmap, Math.max(bitmap.width, bitmap.height), 0.92, 'image/jpeg');
          if (blob) return new File([blob], renamed(file.name, 'jpg'), { type: 'image/jpeg' });
        } finally {
          bitmap.close();
        }
      } else {
        bitmap?.close();
      }
    }
    return imageDataToJpeg(image, file.name);
  } catch (error) {
    // The decoder looked at the file and refused it: the frame was short, or
    // the bytes after the header were not a picture. A browser will still
    // paint the missing tiles green and call that a success, which is the
    // picture that was stored. Only a worker that never started may be handed
    // to the browser.
    if (!(error instanceof Error) || error.message !== 'worker') throw error;
    const bitmap = await decode(file);
    if (!bitmap) throw error;
    try {
      const blob = await encode(bitmap, Math.max(bitmap.width, bitmap.height), 0.92, 'image/jpeg');
      if (!blob) throw new Error('heic');
      return new File([blob], renamed(file.name, 'jpg'), { type: 'image/jpeg' });
    } finally {
      bitmap.close();
    }
  }
}

function decodeHeic(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./heic-decode.worker.ts', import.meta.url));
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('timeout'));
    }, HEIC_TIMEOUT_MS);

    const fail = (error: Error) => {
      clearTimeout(timer);
      worker.terminate();
      reject(error);
    };

    worker.onmessage = (event: MessageEvent<HeicWorkerResponse>) => {
      clearTimeout(timer);
      worker.terminate();
      const data = event.data;
      if (!data || data.error || !data.pixels || data.width < 1 || data.height < 1) {
        reject(new Error(data?.error || 'heic'));
        return;
      }
      resolve(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height));
    };
    worker.onerror = () => fail(new Error('worker'));
    void file.arrayBuffer().then(
      (buffer) => worker.postMessage({ buffer }, [buffer]),
      () => fail(new Error('read')),
    );
  });
}

function imageDataToJpeg(image: ImageData, name: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('canvas'));
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size === 0) reject(new Error('encode'));
      else resolve(new File([blob], renamed(name, 'jpg'), { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  });
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
