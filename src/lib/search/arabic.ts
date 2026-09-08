/**
 * Arabic search normalisation.
 *
 * `to_tsvector('simple', …)` does no stemming and no folding, which in Arabic
 * means ordinary spelling variation breaks matching outright. A listing in
 * المعادي is not found by معادي; مُهندس with harakat is not found by مهندس
 * without them; استشارى typed with a dotless ya is not found by استشاري.
 * Nobody notices at fifteen listings. At five hundred it reads as "your search
 * is broken" rather than as a tuning problem.
 *
 * What this does fold:
 *
 *   - harakat and tatweel, which are typing noise
 *   - أ إ آ ٱ → ا, because which hamza somebody typed is not a distinction
 *     anybody is searching on
 *   - ى → ي and ة → ه, the two endings people type interchangeably
 *   - ؤ → و and ئ → ي
 *   - Arabic-Indic digits → Western, so ٥ finds 5
 *   - the ال prefix, by indexing and querying both forms
 *
 * What it deliberately does not do is pretend to stem. شقة and شقق are a
 * broken plural: no amount of character folding connects them, and a
 * hand-rolled stemmer would be worse than none — it would silently merge words
 * that are genuinely different. That needs a dictionary, and Postgres ships no
 * Arabic one.
 *
 * This exists twice, here and as public.ar_search_text() in migration 23,
 * because one runs on the query and the other inside a generated column. A
 * database test feeds the same corpus through both and asserts they agree, so
 * the pair cannot drift apart unnoticed.
 */

/** Harakat (fathatan…sukun), superscript alef, and tatweel. */
const NOISE = /[ً-ٰٟـ]/g;

const FOLD: Record<string, string> = {
  'آ': 'ا', // آ
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'ٱ': 'ا', // ٱ
  'ى': 'ي', // ى
  'ة': 'ه', // ة
  'ؤ': 'و', // ؤ
  'ئ': 'ي', // ئ
};

/** ٠١٢٣٤٥٦٧٨٩ and the Extended Arabic-Indic ۰۱۲۳۴۵۶۷۸۹. */
function westernDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

export function normaliseArabic(input: string): string {
  const folded = westernDigits(input)
    .replace(NOISE, '')
    .replace(/[آأإٱىةؤئ]/g, (ch) => FOLD[ch] ?? ch);

  return folded.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The same text with a leading ال removed from each word.
 *
 * Only where something is left behind: ال on its own, and الا, are words in
 * their own right rather than an article plus a noun.
 */
export function stripDefiniteArticle(input: string): string {
  return input
    .split(' ')
    .map((word) => (word.length > 4 && word.startsWith('ال') ? word.slice(2) : word))
    .join(' ');
}

/**
 * What actually goes into the index, and into the query.
 *
 * Both forms, so it matches in both directions: a listing written المعادي is
 * found by معادي, and a listing written معادي is found by المعادي.
 */
export function searchText(input: string): string {
  const normalised = normaliseArabic(input);
  const stripped = stripDefiniteArticle(normalised);
  return stripped === normalised ? normalised : `${normalised} ${stripped}`;
}
