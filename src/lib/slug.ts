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

/** Short, URL-safe, collision-resistant enough for a slug suffix. */
export function slugSuffix(length = 4): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Job slugs read as `<title>-<district>-<suffix>`. The suffix keeps the slug
 * unique without a round trip, and keeps job slugs from ever colliding with a
 * programmatic `<track>-<district>` landing page.
 */
export function buildJobSlug(title: string, districtSlug: string): string {
  const base = slugify(title) || 'job';
  return `${base}-${districtSlug}-${slugSuffix()}`;
}

export function buildCompanySlug(name: string): string {
  const base = slugify(name) || 'company';
  return `${base}-${slugSuffix(3)}`;
}

export function buildAgentSlug(fullName: string): string {
  const base = slugify(fullName) || 'agent';
  return `${base}-${slugSuffix()}`;
}
