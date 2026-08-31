/**
 * Slugs are transliterated ASCII in both locales — `property-consultant-new-cairo`,
 * never Arabic-script URLs. Arabic percent-encodes to unreadable byte soup in
 * links, breaks copy-paste sharing, and reads badly in search results.
 */

const ARABIC_MAP: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'e', آ: 'a', ٱ: 'a',
  ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh',
  ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', و: 'w', ي: 'y', ى: 'a', ة: 'a', ء: '', ؤ: 'o', ئ: 'e',
  // Arabic-Indic digits — Western numerals are the convention here.
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

// Harakat, tatweel and other combining marks carry no slug information.
const DIACRITICS = /[ً-ٰٟـ]/g;

export function transliterate(input: string): string {
  return input
    .replace(DIACRITICS, '')
    .split('')
    .map((char) => ARABIC_MAP[char] ?? char)
    .join('');
}

export function slugify(input: string): string {
  return transliterate(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '');
}

/**
 * Random numeric id for the end of a slug — `ahmed-mahmoud-482913`.
 *
 * Random rather than sequential on purpose. A counter in a public URL leaks how
 * many companies or agents exist and how fast they are being added, and it lets
 * anyone walk the whole directory by incrementing. Six digits is a million
 * values, and because the id only has to be unique alongside the name it
 * follows, collisions are confined to people or companies who share a name.
 *
 * Rejection sampling rather than `% 10`: 256 is not a multiple of 10, so a
 * plain modulo would make 0–5 appear slightly more often than 6–9.
 */
export function slugId(digits = 6): string {
  const out: string[] = [];
  const bytes = new Uint8Array(digits * 2);

  while (out.length < digits) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= 250) continue; // 250 = 25 * 10, the largest unbiased range
      out.push(String(byte % 10));
      if (out.length === digits) break;
    }
  }

  // Never start with 0 — a leading zero reads as a typo, and it silently
  // shrinks the space if anything ever parses the id as a number.
  if (out[0] === '0') out[0] = '1';

  return out.join('');
}

/**
 * Job slugs read as `<title>-<district>-<id>`. The id keeps the slug unique
 * without a round trip, and keeps job slugs from ever colliding with a
 * programmatic `<track>-<district>` landing page.
 */
export function buildJobSlug(title: string, districtSlug: string): string {
  const base = slugify(title) || 'job';
  return `${base}-${districtSlug}-${slugId()}`;
}

export function buildCompanySlug(name: string): string {
  const base = slugify(name) || 'company';
  return `${base}-${slugId()}`;
}

export function buildAgentSlug(fullName: string): string {
  const base = slugify(fullName) || 'agent';
  return `${base}-${slugId()}`;
}
