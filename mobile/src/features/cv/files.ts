import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { CV_BUCKET } from '@/lib/buckets';
import { fileExtension, fileType } from '@/lib/file-type';
import { supabase } from '~/lib/supabase';

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

/** Why a picked CV did not reach the bucket. */
export class CvUploadFailed extends Error {
  constructor(readonly reason: 'fileTooLarge' | 'upload') {
    super(reason);
    this.name = 'CvUploadFailed';
  }
}

export async function uploadCv(userId: string, cv: PickedCv): Promise<string> {
  const bytes = await new File(cv.uri).arrayBuffer();
  if (bytes.byteLength > MAX_CV_BYTES) throw new CvUploadFailed('fileTooLarge');
  // The extension from the type, not the name: a provider can hand over a name with none.
  const path = `${userId}/${crypto.randomUUID()}.${fileExtension({ name: cv.name, type: cv.type }, 'pdf')}`;
  const { error } = await supabase.storage.from(CV_BUCKET).upload(path, bytes, { upsert: false, contentType: cv.type });
  if (error) throw new CvUploadFailed('upload');
  return path;
}

/** Never throws: whoever calls it is already telling the person it did not go through. */
export async function removeCv(path: string) {
  await supabase.storage
    .from(CV_BUCKET)
    .remove([path])
    .catch(() => {});
}
