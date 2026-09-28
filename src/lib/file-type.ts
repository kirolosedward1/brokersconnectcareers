/**
 * What an uploaded file is, when the browser will not say.
 *
 * `File.type` is the browser's guess, and it guesses from the operating
 * system: a Windows machine without Office installed has no MIME type
 * registered for .docx, and some Android file providers answer every pick with
 * an empty string or `application/octet-stream`. Every uploader here checked
 * `file.type` against its list and then sent it to storage as the content
 * type, so a perfectly good CV from one of those devices was refused as "the
 * wrong kind of file" — and had it been let through, the bucket's own
 * allowed_mime_types would have refused it instead.
 *
 * So the browser's answer is trusted when it gives one, and the extension
 * decides when it does not. The buckets still enforce their lists: this only
 * names a file the browser failed to, it cannot make a PDF out of anything.
 *
 * Only a name and a reported type are read, so the mobile app's picked
 * documents (a name and a MIME type, no File) are named by the same rules.
 */

/** What these rules read of a file: a browser File, or a picked document's name and type. */
export type NamedFile = { name: string; type: string };
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Spellings older browsers still send for types the buckets know by another name. */
const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

const EXTENSION_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function fileType(file: NamedFile): string {
  const reported = file.type.toLowerCase();
  if (reported && reported !== 'application/octet-stream') return ALIASES[reported] ?? reported;

  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  return BY_EXTENSION[extension] ?? reported;
}

/**
 * The extension to store a file under, from its type rather than its name.
 *
 * A name is whatever the device made up: an Android content provider can hand
 * over `image:1000012345` with no extension at all, which used to become the
 * storage path's suffix verbatim.
 */
export function fileExtension(file: NamedFile, fallback: string): string {
  return EXTENSION_BY_TYPE[fileType(file)] ?? fallback;
}
