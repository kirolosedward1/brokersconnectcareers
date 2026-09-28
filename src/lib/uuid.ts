/**
 * A v4 UUID, on browsers that do not have `crypto.randomUUID`.
 *
 * Four upload paths built their storage key with `crypto.randomUUID()` — the
 * CV on the apply form, the CV on the profile, the company logo, and the
 * verification documents. It is Chrome 92 and Safari 15.4, both 2022, and it
 * is also only defined in a secure context. Most phones have it. The ones that
 * do not are the in-app browsers — a job seeker arriving from a Facebook or
 * Instagram ad opens the site inside one, and this platform's traffic comes
 * from exactly there — where an older WebView means `crypto.randomUUID is not
 * a function`, thrown inside a transition, with nothing on screen to say the
 * upload never started.
 *
 * `getRandomValues` is from 2011 and needs no such caution, so the fallback is
 * a real v4 rather than a weaker id. Math.random is the last resort and only
 * matters for a browser that has neither, where these are path segments in a
 * private bucket that RLS already confines to one account — the id is not what
 * keeps a CV private.
 */
export function uuid(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // Version 4, variant 1 — the two bytes that make it a well-formed v4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
