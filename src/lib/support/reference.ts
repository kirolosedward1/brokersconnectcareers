/**
 * The number somebody reads out to support.
 *
 * Every unexpected failure gets one — on the server when an action refuses in
 * a way nobody planned for, in the browser when the network drops or a page
 * throws — and the same string lands in three places: on the reader's screen,
 * in the platform log line, and in a support_events row an admin can search.
 * That is the whole job. It is a handle, not a secret, so it carries nothing
 * that means anything on its own: no row id, no user id, no time.
 *
 * `BC-7K3M-9QX2`. Eight characters of Crockford base32 — forty random bits,
 * which at this platform's scale will not collide in its lifetime, and short
 * enough to type into a WhatsApp message from a phone. Crockford because the
 * alphabet has no I, L, O or U: the four characters people misread for 1, 1,
 * 0 and V, which matters for a string that is copied by eye off a screen.
 *
 * Isomorphic on purpose. The browser mints the reference for a failure only
 * the browser saw, and the server for one only it saw; both must agree on the
 * shape, so both use this file.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The shape, anchored. The database checks the same pattern. */
export const REFERENCE_PATTERN = /^BC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * A fresh reference.
 *
 * `crypto.getRandomValues` exists in every browser this site supports and in
 * Node 22 as a global, so there is one implementation rather than two. A byte
 * modulo 32 is uniform, because 256 is a multiple of 32.
 */
export function newReference(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % 32]);
  return `BC-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** Arabic-Indic and Eastern Arabic-Indic digits, as an Egyptian keyboard types them. */
const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * What somebody typed, turned back into the reference it was meant to be.
 *
 * People retype these from a screenshot, into a phone, sometimes in Arabic
 * digits, sometimes without the dashes, sometimes with an O where the zero
 * was. Crockford's decoding rules exist for exactly this — O reads as 0, I and
 * L as 1 — so a support search finds the row the reader meant rather than
 * reporting that it does not exist. Returns null for anything that cannot be
 * a reference, so a caller can tell "not found" from "not a reference".
 */
export function normaliseReference(input: string | null | undefined): string | null {
  if (!input) return null;

  const cleaned = input
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit] ?? digit)
    .toUpperCase()
    .replace(/[\s‎‏⁦-⁩_–—-]/g, '')
    .replace(/^BC/, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(cleaned)) return null;
  return `BC-${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

export function isReference(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE_PATTERN.test(value);
}
