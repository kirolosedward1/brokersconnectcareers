import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';
import { CV_BUCKET } from '@/lib/buckets';
import { fileExtension, fileType } from '@/lib/file-type';
import { supabase } from '~/lib/supabase';
import { withTimeout } from '~/lib/timeout';

/**
 * A CV from the phone: picked with the system's document picker, checked as
 * the website's forms check one, and uploaded to the private `cvs` bucket in
 * the candidate's own folder — `cvs/<uid>/<uuid>.<ext>` — before the action
 * that uses it runs (applyToJob, saveAgentProfile: they take a path, not
 * bytes, and sniff what is behind it). Whoever uploads takes the file back
 * out if the action refuses it.
 */

export const MAX_CV_BYTES = 10 * 1024 * 1024;
export const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export type PickedCv = { uri: string; name: string; type: string };

/** What the file checks can say, as the website's `validation.*` words. */
export type CvProblem = 'fileType' | 'fileTooLarge';

/** A PDF or a Word file, or why not; null when the picker was closed. */
export async function pickCv(): Promise<{ cv: PickedCv } | { problem: CvProblem } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: CV_TYPES, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  // A provider that reports no type, or octet-stream, is named by the extension.
  const type = fileType({ name: asset.name, type: asset.mimeType ?? '' });
  if (!CV_TYPES.includes(type)) return { problem: 'fileType' };
  if ((asset.size ?? 0) > MAX_CV_BYTES) return { problem: 'fileTooLarge' };
  return { cv: { uri: asset.uri, name: asset.name, type } };
}

/** Why a picked CV did not reach the bucket, with what went wrong to show the person. */
export class CvUploadFailed extends Error {
  constructor(
    readonly reason: 'fileTooLarge' | 'upload',
    readonly detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'CvUploadFailed';
  }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 to bytes, without relying on atob or a Buffer the engine may not have. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (let index = 0; index < clean.length; index += 1) {
    value = (value << 6) | BASE64.indexOf(clean[index]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The picked file's bytes: through expo-file-system's File first, and when
 * that fails (an iCloud or provider URI it will not open, a runtime whose
 * native module is older than the JavaScript, as in Expo Go) through the
 * legacy API as base64. Both failing is said with both reasons.
 */
/** How long each step of a CV's upload may take before it is said as failed. */
export const CV_READ_TIMEOUT_MS = 15_000;
export const CV_SESSION_TIMEOUT_MS = 15_000;
export const CV_UPLOAD_TIMEOUT_MS = 60_000;

export async function readCvBytes(uri: string): Promise<ArrayBuffer> {
  let first: unknown;
  try {
    const bytes = await withTimeout(new File(uri).arrayBuffer(), CV_READ_TIMEOUT_MS, 'reading the file');
    if (bytes.byteLength > 0) return bytes;
    first = new Error('empty file');
  } catch (error) {
    first = error;
  }
  try {
    const base64 = await withTimeout(
      LegacyFileSystem.readAsStringAsync(uri, { encoding: LegacyFileSystem.EncodingType.Base64 }),
      CV_READ_TIMEOUT_MS,
      'reading the file (base64)',
    );
    const bytes = base64ToBytes(base64);
    if (bytes.byteLength === 0) throw new Error('empty file');
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch (second) {
    throw new CvUploadFailed('upload', `read: ${describe(first)}; ${describe(second)}`);
  }
}

export async function uploadCv(userId: string, cv: PickedCv): Promise<string> {
  const bytes = await readCvBytes(cv.uri);
  if (bytes.byteLength > MAX_CV_BYTES) throw new CvUploadFailed('fileTooLarge');
  // The extension from the type, not the name: a provider can hand over a name with none.
  const path = `${userId}/${crypto.randomUUID()}.${fileExtension({ name: cv.name, type: cv.type }, 'pdf')}`;
  // The session first, on a clock of its own: storage asks supabase-js for the
  // token, which waits out a refresh in flight (half a minute of retries
  // offline), and the upload's request had not even left the phone.
  let error: unknown;
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), CV_SESSION_TIMEOUT_MS, 'the session');
    if (!data.session) throw new Error('not signed in on this phone');
    ({ error } = await withTimeout(
      supabase.storage.from(CV_BUCKET).upload(path, bytes, { upsert: false, contentType: cv.type }),
      CV_UPLOAD_TIMEOUT_MS,
      'the upload',
    ));
  } catch (thrown) {
    error = thrown;
  }
  if (error) throw new CvUploadFailed('upload', `storage: ${describe(error)}`);
  return path;
}

/** Never throws: whoever calls it is already telling the person it did not go through. */
export async function removeCv(path: string) {
  await withTimeout(Promise.resolve(supabase.storage.from(CV_BUCKET).remove([path])), 10_000, 'removing the file').catch(() => {});
}

/**
 * Open one of the person's own CVs to read: a five-minute signed address from
 * the private bucket, which lets its owner read their own folder (storage
 * policy, migration 006), shown in the in-app browser.
 */
export async function openOwnCv(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(CV_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw error ?? new Error('cv: no signed address');
  await WebBrowser.openBrowserAsync(data.signedUrl);
}
