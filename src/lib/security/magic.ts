/**
 * What a file is, decided from its bytes.
 *
 * The browser's `file.type` is whatever the browser guessed from the
 * extension, and the extension is whatever the person typed. Neither is
 * evidence. The bucket's MIME allow-list checks the same declared type, so it
 * refuses a `.exe` but not an `.exe` renamed `.pdf`. This reads the first
 * kilobytes and recognises the handful of formats the platform accepts by
 * their magic numbers; everything else is refused, whatever it claims to be.
 *
 * Recognition is not a malware scan. A well-formed PDF can carry a hostile
 * payload, and nothing here would know. What this closes is the class of
 * "not actually a document at all" — an HTML page, a script, an executable,
 * an archive — which is what gets a file into a place it can run.
 *
 * Pure, and free of Node imports, so the tests can load it directly.
 */

export type FileKind = 'pdf' | 'docx' | 'doc' | 'png' | 'jpeg' | 'webp';

const MAGIC: { kind: FileKind; test: (b: Uint8Array) => boolean }[] = [
  { kind: 'pdf', test: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },            // %PDF-
  { kind: 'png', test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { kind: 'jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    kind: 'webp',
    test: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, 12) === 'WEBP',    // RIFF....WEBP
  },
  // Compound File Binary — the container of a legacy .doc (and .xls, .ppt, and
  // a great many things that are not documents; the caller decides if it
  // wants this kind at all).
  { kind: 'doc', test: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
  // A .docx is a zip whose first entry names the Office package. The first
  // local file header is at offset 0 and its name follows at 30; every real
  // Word document puts [Content_Types].xml or _rels first.
  {
    kind: 'docx',
    test: (b) =>
      startsWith(b, [0x50, 0x4b, 0x03, 0x04]) &&
      (ascii(b, 30, 49) === '[Content_Types].xml' ||
        ascii(b, 30, 36) === '_rels/' ||
        ascii(b, 30, 35) === 'word/' ||
        ascii(b, 30, 39) === 'docProps/'),
  },
];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.slice(from, Math.min(to, bytes.length)));
}

/** The kind these bytes are, or null when they are none of the accepted ones. */
export function sniffKind(bytes: Uint8Array): FileKind | null {
  for (const { kind, test } of MAGIC) {
    if (test(bytes)) return kind;
  }
  return null;
}

export const CV_KINDS: readonly FileKind[] = ['pdf', 'docx', 'doc'];
export const IMAGE_KINDS: readonly FileKind[] = ['png', 'jpeg', 'webp'];
export const DOCUMENT_KINDS: readonly FileKind[] = ['pdf', 'png', 'jpeg'];

/** The shape a storage path must have: the owner's folder and one file name. */
export function isOwnedPath(path: string, owner: string): boolean {
  return new RegExp(`^${owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z0-9._-]{1,160}$`).test(path);
}

